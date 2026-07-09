// =====================================================
// EMISOR (NODO SENSOR) -> LoRa
// SHTC3 + DS18B20 + GPS + batería -> JSON -> RFM95W
//
// + Ventana de comandos: tras enviar datos abre CMD_WINDOW_MS de escucha LoRa.
//   Si llega un comando dirigido a este dispositivo, lo ejecuta y
//   guarda la nueva configuración en NVS (sobrevive deep sleep).
//
// Configuración en 2 niveles (prioridad):
//   1. NVS (Preferences) — cargado por la plataforma web vía serial
//   2. secrets.h + board_config.h (#define) — generados por la plataforma
//   Si ninguno: entra en modo provisioning y espera JSON por serial
// =====================================================
#include <Wire.h>
#include <Adafruit_SHTC3.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <RH_RF95.h>
#include <math.h>
#include <esp_sleep.h>
#include <Preferences.h>

#include "board_config.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

// =====================
// Config global (llenada por loadConfig)
// =====================
String  g_device_id    = "";
int     g_sleep_min    = DEFAULT_SLEEP_MIN;

// Flags de sensores habilitados (modificables remotamente)
bool g_en_SHTC3   = SENSOR_SHTC3_DEFAULT;
bool g_en_DS18B20 = SENSOR_DS18B20_DEFAULT;
bool g_en_GPS     = SENSOR_GPS_DEFAULT;

// Config LoRa (modificable remotamente)
// g_lora_sf = 0 significa "no tocar" → RadioHead usa su default SF7 (Bw125Cr45Sf128)
// El receptor también debe usar el mismo SF. Cambiar solo coordinando ambos lados.
int g_lora_sf  = LORA_SF_DEFAULT;
int g_lora_pwr = LORA_TX_DBM;

// =====================
// RTC memory — sobrevive deep sleep
// =====================
RTC_DATA_ATTR double   rtc_lat       = 0.0;
RTC_DATA_ATTR double   rtc_lon       = 0.0;
RTC_DATA_ATTR float    rtc_alt_m     = 0.0;
RTC_DATA_ATTR float    rtc_vel_kmh   = 0.0;
RTC_DATA_ATTR float    rtc_hdop      = 0.0;
RTC_DATA_ATTR uint32_t rtc_sats      = 0;
RTC_DATA_ATTR bool     rtc_gps_valid = false;

// =====================
// Tipos
// =====================
struct THReading  { float temp_c; float hum_pct; bool ok; };
struct DSReading  { float temp_c; bool ok; };
struct GpsReading {
  bool valid;
  bool cached;
  double lat, lon;
  float alt_m, vel_kmh, hdop;
  uint32_t sats;
};

// =====================
// Prototipos
// =====================
void loraHardReset();
void readGPS();
void setupBatteryAdc();
float readVbat();
int vbatToPercent(float v);
THReading readSHTC3();
DSReading readDS18B20();
void buildJsonPayload(String &out, const THReading&, const DSReading&,
                      const GpsReading&, float vbat, int batPct, int gpsLevel);
void processCommand(const String& rawCmd);
void goToDeepSleep();
void enterProvisioningMode();
void loadConfig();

// =====================
// Hardware (pines desde board_config.h)
// =====================
TinyGPSPlus gps;
HardwareSerial GPSSerial(1);
Adafruit_SHTC3 shtc3;
OneWire oneWire(DS18B20_PIN);
DallasTemperature ds(&oneWire);
DeviceAddress dsAddr;
bool dsFound = false;

RH_RF95 rf95(LORA_CS_PIN, LORA_DIO0_PIN);

// =============================================
// Carga de configuración (NVS -> secrets.h -> provisioning)
// =============================================
void loadConfig() {
  Preferences prefs;
  prefs.begin("agro", true);
  String nvsId = prefs.getString("device_id", "");
  int nvsSleep  = prefs.getInt("sleep_min", 0);

  g_en_SHTC3   = prefs.getBool("en_SHTC3",   SENSOR_SHTC3_DEFAULT);
  g_en_DS18B20 = prefs.getBool("en_DS18B20", SENSOR_DS18B20_DEFAULT);
  g_en_GPS     = prefs.getBool("en_GPS",     SENSOR_GPS_DEFAULT);
  g_lora_sf    = prefs.getInt("lora_sf",  LORA_SF_DEFAULT);
  g_lora_pwr   = prefs.getInt("lora_pwr", LORA_TX_DBM);
  prefs.end();

  if (nvsId.length() > 0) {
    g_device_id = nvsId;
    g_sleep_min = (nvsSleep > 0) ? nvsSleep : DEFAULT_SLEEP_MIN;
    Serial.println("[CONFIG] NVS OK — " + g_device_id);
    Serial.printf("[CONFIG] sleep=%dmin  SHTC3=%s  DS18=%s  GPS=%s  SF=%d  PWR=%ddBm\n",
      g_sleep_min,
      g_en_SHTC3   ? "ON" : "OFF",
      g_en_DS18B20 ? "ON" : "OFF",
      g_en_GPS     ? "ON" : "OFF",
      g_lora_sf, g_lora_pwr);
    return;
  }

#ifdef DEVICE_ID_SECRET
  g_device_id = DEVICE_ID_SECRET;
  g_sleep_min = SLEEP_MINUTES;
  Serial.println("[CONFIG] secrets.h — " + g_device_id);
  return;
#endif

  enterProvisioningMode();
}

// =============================================
// Modo provisioning
// =============================================
void enterProvisioningMode() {
  Serial.println("[PROV] Sin configuracion detectada. Modo provisioning activo.");

  String incoming = "";
  unsigned long deadline = millis() + 90000UL;
  unsigned long lastReady = 0;

  while (millis() < deadline) {
    if (millis() - lastReady >= 1000) {
      Serial.println("PROV_READY");
      lastReady = millis();
    }

    while (Serial.available()) {
      char c = Serial.read();
      if (c == '\n' || c == '\r') {
        incoming.trim();
        if (incoming.length() > 5) {
          StaticJsonDocument<256> cfg;
          if (!deserializeJson(cfg, incoming)) {
            const char* did = cfg["device_id"];
            int sm = cfg["sleep_minutes"] | DEFAULT_SLEEP_MIN;
            if (did && strlen(did) > 0) {
              Preferences prefs;
              prefs.begin("agro", false);
              prefs.putString("device_id", did);
              prefs.putInt("sleep_min", sm);
              prefs.end();
              Serial.println("PROV_OK");
              delay(200);
              ESP.restart();
            }
          }
        }
        incoming = "";
      } else if (c >= 32) {
        incoming += c;
      }
    }
    delay(10);
  }

  Serial.println("[PROV] Timeout. Usando defaults temporales.");
  g_device_id = "agro-sin-config";
  g_sleep_min = DEFAULT_SLEEP_MIN;
}

// =====================
// Battery
// =====================
void setupBatteryAdc() {
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  analogRead(BAT_ADC_PIN);
}

float readVbat() {
  uint32_t acc = 0;
  for (int i = 0; i < BAT_SAMPLES; i++) { acc += analogRead(BAT_ADC_PIN); delay(2); }
  return ((float)acc / BAT_SAMPLES) * (BAT_VREF / BAT_ADC_MAX) * BAT_DIV_RATIO;
}

int vbatToPercent(float v) {
  if (v >= BAT_V_MAX) return 100;
  if (v <= BAT_V_MIN) return 0;
  // Curva de descarga Li-Ion interpolada por tramos
  if (v > 4.10f) return (int)map((int)(v*1000), 4100, (int)(BAT_V_MAX*1000), 90, 100);
  if (v > 4.00f) return (int)map((int)(v*1000), 4000, 4100, 80,  90);
  if (v > 3.92f) return (int)map((int)(v*1000), 3920, 4000, 70,  80);
  if (v > 3.85f) return (int)map((int)(v*1000), 3850, 3920, 60,  70);
  if (v > 3.80f) return (int)map((int)(v*1000), 3800, 3850, 50,  60);
  if (v > 3.75f) return (int)map((int)(v*1000), 3750, 3800, 40,  50);
  if (v > 3.70f) return (int)map((int)(v*1000), 3700, 3750, 30,  40);
  if (v > 3.60f) return (int)map((int)(v*1000), 3600, 3700, 15,  30);
  return (int)map((int)(v*1000), (int)(BAT_V_MIN*1000), 3600, 0, 15);
}

// =====================
// Helpers
// =====================
void loraHardReset() {
  pinMode(LORA_RST_PIN, OUTPUT);
  digitalWrite(LORA_RST_PIN, HIGH); delay(10);
  digitalWrite(LORA_RST_PIN, LOW);  delay(10);
  digitalWrite(LORA_RST_PIN, HIGH); delay(10);
}

void readGPS() {
  while (GPSSerial.available() > 0) gps.encode(GPSSerial.read());
}

// =====================
// Sensor reads
// =====================
THReading readSHTC3() {
  THReading r{0, 0, false};
  if (!g_en_SHTC3) return r;
  sensors_event_t h, t;
  if (shtc3.getEvent(&h, &t)) { r.temp_c = t.temperature; r.hum_pct = h.relative_humidity; r.ok = true; }
  return r;
}

DSReading readDS18B20() {
  DSReading r{0, false};
  if (!g_en_DS18B20 || !dsFound) return r;
  ds.requestTemperatures();
  float t = ds.getTempC(dsAddr);
  if (t != DEVICE_DISCONNECTED_C) { r.temp_c = t; r.ok = true; }
  return r;
}

// =====================
// JSON builder
// gpsLevel 2:full 1:lat/lon/sats 0:lat/lon -1:sin GPS
// =====================
void buildJsonPayload(String &out, const THReading& amb, const DSReading& probe,
                      const GpsReading& gpsData, float vbat, int batPct, int gpsLevel) {
  StaticJsonDocument<512> doc;
  doc["device_id"] = g_device_id;

  JsonObject ambObj   = doc.createNestedObject("amb");
  ambObj["ok"] = amb.ok;
  if (amb.ok) { ambObj["temp_c"] = amb.temp_c; ambObj["hum_pct"] = amb.hum_pct; }

  JsonObject probeObj = doc.createNestedObject("probe");
  probeObj["ok"] = probe.ok;
  if (probe.ok) probeObj["temp_c"] = probe.temp_c;

  JsonObject batObj = doc.createNestedObject("bat");
  batObj["v"] = vbat; batObj["pct"] = batPct;

  if (gpsData.valid && gpsLevel >= 0) {
    JsonObject g = doc.createNestedObject("gps");
    g["valid"] = true;
    if (gpsData.cached) g["cached"] = true;
    g["lat"] = gpsData.lat; g["lon"] = gpsData.lon;
    if (gpsLevel >= 1) g["sats"] = gpsData.sats;
    if (gpsLevel >= 2) { g["alt_m"] = gpsData.alt_m; g["vel_kmh"] = gpsData.vel_kmh; g["hdop"] = gpsData.hdop; }
  }

  out = ""; serializeJson(doc, out);
}

// =============================================
// Procesamiento de comandos recibidos por LoRa
//
// Formato esperado del paquete:
//   {"target":"<device_id>","cmd_id":N,"type":"...","params":{...}}
//
// Comandos soportados:
//   set_sleep        params: {"minutes": N}
//   disable_sensor   params: {"sensor": "SHTC3"|"DS18B20"|"GPS"|"BAT"}
//   enable_sensor    params: {"sensor": "SHTC3"|"DS18B20"|"GPS"|"BAT"}
//   set_lora_sf      params: {"sf": 7-12}
//   set_lora_power   params: {"dbm": 2-20}
//   restart          params: {}
// =============================================
void processCommand(const String& rawCmd) {
  StaticJsonDocument<256> cmdDoc;
  if (deserializeJson(cmdDoc, rawCmd)) {
    Serial.println("[CMD] JSON invalido");
    return;
  }

  const char* target = cmdDoc["target"];
  if (!target || g_device_id != String(target)) {
    Serial.printf("[CMD] Ignorado — target '%s' != '%s'\n",
      target ? target : "null", g_device_id.c_str());
    return;
  }

  int         cmdId   = cmdDoc["cmd_id"] | 0;
  const char* cmdType = cmdDoc["type"] | "";
  Serial.printf("[CMD] Ejecutando cmd_id=%d type=%s\n", cmdId, cmdType);

  Preferences prefs;

  if (strcmp(cmdType, "set_sleep") == 0) {
    int mins = cmdDoc["params"]["minutes"] | g_sleep_min;
    mins = constrain(mins, 1, 60);
    prefs.begin("agro", false);
    prefs.putInt("sleep_min", mins);
    prefs.end();
    g_sleep_min = mins;
    Serial.printf("[CMD] sleep_min -> %d min\n", mins);
  }
  else if (strcmp(cmdType, "disable_sensor") == 0) {
    const char* sensor = cmdDoc["params"]["sensor"] | "";
    String key = String("en_") + sensor;
    prefs.begin("agro", false);
    prefs.putBool(key.c_str(), false);
    prefs.end();
    Serial.printf("[CMD] Sensor %s DESACTIVADO\n", sensor);
  }
  else if (strcmp(cmdType, "enable_sensor") == 0) {
    const char* sensor = cmdDoc["params"]["sensor"] | "";
    String key = String("en_") + sensor;
    prefs.begin("agro", false);
    prefs.putBool(key.c_str(), true);
    prefs.end();
    Serial.printf("[CMD] Sensor %s ACTIVADO\n", sensor);
  }
  else if (strcmp(cmdType, "set_lora_sf") == 0) {
    int sf = cmdDoc["params"]["sf"] | g_lora_sf;
    sf = constrain(sf, 7, 12);
    prefs.begin("agro", false);
    prefs.putInt("lora_sf", sf);
    prefs.end();
    Serial.printf("[CMD] LoRa SF -> %d (efecto en próximo ciclo)\n", sf);
  }
  else if (strcmp(cmdType, "set_lora_power") == 0) {
    int dbm = cmdDoc["params"]["dbm"] | g_lora_pwr;
    dbm = constrain(dbm, 2, 20);
    prefs.begin("agro", false);
    prefs.putInt("lora_pwr", dbm);
    prefs.end();
    g_lora_pwr = dbm;
    rf95.setTxPower(dbm, false);
    Serial.printf("[CMD] LoRa power -> %d dBm\n", dbm);
  }
  else if (strcmp(cmdType, "restart") == 0) {
    Serial.println("[CMD] Reiniciando en 1s...");
    delay(1000);
    ESP.restart();
  }
  else {
    Serial.printf("[CMD] Tipo desconocido: %s\n", cmdType);
  }
}

// =====================
// Deep sleep
// =====================
void goToDeepSleep() {
  Serial.print("[SLEEP] Durmiendo "); Serial.print(g_sleep_min); Serial.println(" min");
  Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)g_sleep_min * 60ULL * 1000000ULL);
  esp_deep_sleep_start();
}

// =====================
// Setup
// =====================
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("============================================================");
  Serial.println("   EMISOR AgroESP32  |  inicio");
  Serial.println("============================================================");

  loadConfig();
  setupBatteryAdc();

  // --- Sensores ---
  Serial.println();
  Serial.println("[ SENSORES ]");
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (g_en_SHTC3) {
    if (shtc3.begin()) Serial.println("  SHTC3   : OK");
    else               Serial.println("  SHTC3   : NO encontrado");
  } else {
    Serial.println("  SHTC3   : DESACTIVADO");
  }

  if (g_en_DS18B20) {
    ds.begin(); ds.setResolution(DS18B20_RESOLUTION);
    dsFound = ds.getAddress(dsAddr, 0);
    Serial.println(dsFound ? "  DS18B20 : OK" : "  DS18B20 : NO encontrado");
  } else {
    Serial.println("  DS18B20 : DESACTIVADO");
  }

  if (g_en_GPS) {
    GPSSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  } else {
    Serial.println("  GPS     : DESACTIVADO");
  }

  // --- LoRa ---
  Serial.println();
  Serial.println("[ LORA ]");
  SPI.begin(LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_CS_PIN);
  loraHardReset();

  if (!rf95.init())                       { Serial.println("  ERROR: init fallido"); goToDeepSleep(); }
  if (!rf95.setFrequency(LORA_FREQ_MHZ)) { Serial.println("  ERROR: frecuencia fallida"); goToDeepSleep(); }
  rf95.setModemConfig(RH_RF95::Bw125Cr45Sf128);
  rf95.spiWrite(0x39, LORA_SYNC_WORD);
  if (g_lora_sf > 0) rf95.setSpreadingFactor(g_lora_sf);
  rf95.setTxPower(g_lora_pwr, false);

  // Verificación SPI: REG_VERSION (0x42) debe devolver 0x12 en SX1276
  uint8_t ver = rf95.spiRead(0x42);
  Serial.printf("  Freq: %.0f MHz  SF: %s  BW: 125  SyncWord: 0x%02X  Power: %d dBm\n",
    LORA_FREQ_MHZ, g_lora_sf > 0 ? String(g_lora_sf).c_str() : "7", LORA_SYNC_WORD, g_lora_pwr);
  Serial.printf("  SX1276 version reg: 0x%02X %s\n", ver,
    ver == 0x12 ? "(OK)" : "(ERROR — revisar cableado SPI/CS)");

  // --- GPS ---
  if (g_en_GPS) {
    Serial.println();
    Serial.println("[ GPS ]");
    unsigned long gpsTimeout = rtc_gps_valid
      ? (unsigned long)GPS_TIMEOUT_WARM_S * 1000UL
      : (unsigned long)GPS_TIMEOUT_COLD_S * 1000UL;
    if (rtc_gps_valid)
      Serial.printf("  Cache disponible: lat %.5f lon %.5f\n", rtc_lat, rtc_lon);
    else
      Serial.println("  Cold start");
    Serial.printf("  Timeout: %lu s\n", gpsTimeout / 1000);

    unsigned long t0 = millis();
    unsigned long lastProgress = 0;
    bool fixFound = false;

    while (millis() - t0 < gpsTimeout) {
      readGPS();
      if (gps.location.isValid() && gps.location.age() < 2000 && gps.satellites.value() >= GPS_MIN_SATS) {
        rtc_lat = gps.location.lat(); rtc_lon = gps.location.lng();
        rtc_alt_m = gps.altitude.meters(); rtc_vel_kmh = gps.speed.kmph();
        rtc_hdop = gps.hdop.hdop(); rtc_sats = gps.satellites.value();
        rtc_gps_valid = true; fixFound = true;
        break;
      }
      if (millis() - lastProgress >= 5000) {
        lastProgress = millis();
        Serial.printf("  %2lus | sats: %u | valido: %s\n",
          (millis() - t0) / 1000, gps.satellites.value(),
          gps.location.isValid() ? "si" : "no");
      }
      delay(20);
    }

    if (fixFound) {
      Serial.printf("  FIX OK: %.6f / %.6f  sats=%u\n", rtc_lat, rtc_lon, rtc_sats);
    } else if (rtc_gps_valid) {
      Serial.println("  Sin fix nuevo — usando cache RTC");
    } else {
      Serial.println("  SIN DATOS GPS");
    }
  }

  // Re-inicializar LoRa después del GPS loop.
  // El SX1276 puede caer en SLEEP durante una espera larga. Re-init garantiza
  // que el radio esté en STANDBY con la config correcta antes de TX.
  Serial.println();
  Serial.println("[ LORA RE-INIT ]");
  loraHardReset();
  if (!rf95.init())                       { Serial.println("  ERROR: init fallido"); goToDeepSleep(); }
  if (!rf95.setFrequency(LORA_FREQ_MHZ)) { Serial.println("  ERROR: frecuencia fallida"); goToDeepSleep(); }
  rf95.setModemConfig(RH_RF95::Bw125Cr45Sf128);
  rf95.spiWrite(0x39, LORA_SYNC_WORD);
  if (g_lora_sf > 0) rf95.setSpreadingFactor(g_lora_sf);
  rf95.setTxPower(g_lora_pwr, false);
  uint8_t modeAfterInit = rf95.spiRead(0x01);
  Serial.printf("  OP_MODE post-init: 0x%02X %s\n", modeAfterInit,
    modeAfterInit == 0x81 ? "(STANDBY OK)" : "(ERROR)");
}

// =====================
// Loop: una vez y duerme
// =====================
void loop() {
  if (g_en_GPS) readGPS();

  THReading amb   = readSHTC3();
  DSReading probe = readDS18B20();
  float vbat   = readVbat();
  int   batPct = vbatToPercent(vbat);

  GpsReading gpsData = {false, false, 0, 0, 0, 0, 0, 0};
  if (g_en_GPS) {
    bool freshFix = gps.location.isValid() && gps.location.age() < 3000 && gps.satellites.value() >= GPS_MIN_SATS;
    if (freshFix) {
      gpsData = {true, false, gps.location.lat(), gps.location.lng(),
                 gps.altitude.meters(), gps.speed.kmph(), gps.hdop.hdop(), gps.satellites.value()};
    } else if (rtc_gps_valid) {
      gpsData = {true, true, rtc_lat, rtc_lon, rtc_alt_m, rtc_vel_kmh, rtc_hdop, rtc_sats};
    }
  }

  const int MAX_LORA = RH_RF95_MAX_MESSAGE_LEN - 1;
  String payload;
  buildJsonPayload(payload, amb, probe, gpsData, vbat, batPct, 2);
  if (payload.length() > MAX_LORA) buildJsonPayload(payload, amb, probe, gpsData, vbat, batPct, 1);
  if (payload.length() > MAX_LORA) buildJsonPayload(payload, amb, probe, gpsData, vbat, batPct, 0);
  if (payload.length() > MAX_LORA) buildJsonPayload(payload, amb, probe, gpsData, vbat, batPct, -1);

  Serial.println();
  Serial.println("[ TRANSMISION ]");
  Serial.printf("  Bateria  : %.2f V  (%d%%)\n", vbat, batPct);
  if (amb.ok)        Serial.printf("  Ambiente : %.1f C  %.1f%% HR\n", amb.temp_c, amb.hum_pct);
  else               Serial.println("  Ambiente : sin datos");
  if (probe.ok)      Serial.printf("  Suelo    : %.1f C\n", probe.temp_c);
  else               Serial.println("  Suelo    : sin datos");
  if (gpsData.valid) Serial.printf("  GPS      : %.6f / %.6f  sats=%u%s\n",
    gpsData.lat, gpsData.lon, gpsData.sats, gpsData.cached ? " [cache]" : "");
  else               Serial.println("  GPS      : sin datos");
  Serial.printf("  Payload  : %d bytes\n", payload.length());
  Serial.printf("  JSON     : %s\n", payload.c_str());

  bool sent = false;
  if (payload.length() <= MAX_LORA) {
    rf95.spiWrite(0x12, 0xFF);  // limpiar IRQ flags residuales
    rf95.send((const uint8_t*)payload.c_str(), payload.length());

    // Polling REG_IRQ_FLAGS con timeout 3s (evita colgar si DIO0 no interrumpe)
    unsigned long txStart = millis();
    bool txDone = false;
    while (millis() - txStart < 3000) {
      if (rf95.spiRead(0x12) & 0x08) {  // TxDone bit
        rf95.spiWrite(0x12, 0xFF);
        txDone = true;
        break;
      }
      delay(5);
    }

    if (txDone) {
      Serial.printf("  Enviado  : OK  (%lu ms)\n", millis() - txStart);
      rf95.setModeRx();
      sent = true;
    } else {
      uint8_t finalMode = rf95.spiRead(0x01);
      uint8_t finalIrq  = rf95.spiRead(0x12);
      Serial.printf("  Enviado  : TX timeout  OP_MODE=0x%02X  IRQ=0x%02X\n", finalMode, finalIrq);
    }
  } else {
    Serial.println("  ERROR    : payload demasiado grande");
  }

  // =============================================
  // Ventana de comandos remotos (CMD_WINDOW_MS)
  // El receptor tiene ~2s para: POST a la API + consultar relay + enviar LoRa.
  // CMD_WINDOW_MS garantiza margen con latencia de red variable.
  // =============================================
  if (sent) {
    Serial.println();
    Serial.println("[ COMANDOS ]");
    Serial.println("  Esperando comandos del receptor...");

    unsigned long cmdDeadline = millis() + CMD_WINDOW_MS;
    bool cmdReceived = false;
    while (millis() < cmdDeadline) {
      if (rf95.available()) {
        uint8_t cmdBuf[RH_RF95_MAX_MESSAGE_LEN];
        uint8_t cmdLen = sizeof(cmdBuf);
        if (rf95.recv(cmdBuf, &cmdLen)) {
          String rawCmd((char*)cmdBuf, cmdLen);
          Serial.printf("  Recibido : %s\n", rawCmd.c_str());
          processCommand(rawCmd);
          cmdReceived = true;
        }
        break;
      }
      delay(20);
    }
    if (!cmdReceived) Serial.println("  Sin comandos.");
  }

  goToDeepSleep();
}
