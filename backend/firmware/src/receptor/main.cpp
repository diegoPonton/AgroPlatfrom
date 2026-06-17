// =====================================================
// RECEPTOR (GATEWAY) LoRa -> WiFi -> API POST
// + Relay de comandos: tras cada POST exitoso consulta
//   GET /api/relay/?token=...&emitter=<device_id>
//   y retransmite los comandos pendientes por LoRa
//
// Configuración en 2 niveles (prioridad):
//   1. NVS (Preferences) — cargado por la plataforma web vía serial
//   2. secrets.h + board_config.h (#define) — generados por la plataforma
//   Si ninguno: entra en modo provisioning y espera JSON por serial
// =====================================================
#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <RH_RF95.h>
#include <ArduinoJson.h>
#include <Preferences.h>

#include "board_config.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

// =====================
// Config global
// =====================
String g_wifi_ssid  = "";
String g_wifi_pass  = "";
String g_api_url    = "";   // termina en "api/telemetry/"
String g_api_token  = "";

// =====================
// Hardware
// =====================
RH_RF95 rf95(LORA_CS_PIN, LORA_DIO0_PIN);

// =====================
// Prototipos
// =====================
void loraHardReset();
void connectWiFi();
bool postToAPI(const String& payload);
void checkAndRelayCommands(const String& emitterDeviceId);
void loadConfig();
void enterProvisioningMode();

// =============================================
// Carga de configuración (NVS -> secrets.h -> provisioning)
// =============================================
void loadConfig() {
  Preferences prefs;
  prefs.begin("agro", true);
  String nvsToken = prefs.getString("api_token", "");
  if (nvsToken.length() > 0) {
    g_wifi_ssid = prefs.getString("wifi_ssid", "");
    g_wifi_pass = prefs.getString("wifi_pass", "");
    g_api_url   = prefs.getString("api_url",   "");
    g_api_token = nvsToken;
    prefs.end();
    Serial.println("[CONFIG] NVS OK");
    return;
  }
  prefs.end();

#ifdef WIFI_SSID_SECRET
  g_wifi_ssid = WIFI_SSID_SECRET;
  g_wifi_pass = WIFI_PASS_SECRET;
  g_api_url   = API_URL_SECRET;
  g_api_token = API_TOKEN_SECRET;
  Serial.println("[CONFIG] secrets.h OK");
  return;
#endif

  enterProvisioningMode();
}

// =============================================
// Modo provisioning
// =============================================
void enterProvisioningMode() {
  Serial.println("[PROV] Sin configuracion. Modo provisioning activo.");

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
          StaticJsonDocument<512> cfg;
          if (!deserializeJson(cfg, incoming)) {
            const char* ssid  = cfg["wifi_ssid"];
            const char* pass  = cfg["wifi_pass"];
            const char* url   = cfg["api_url"];
            const char* token = cfg["api_token"];
            if (ssid && token && strlen(ssid) > 0 && strlen(token) > 0) {
              Preferences prefs;
              prefs.begin("agro", false);
              prefs.putString("wifi_ssid", ssid);
              prefs.putString("wifi_pass", pass ? pass : "");
              prefs.putString("api_url",   url  ? url  : "");
              prefs.putString("api_token", token);
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

  Serial.println("[PROV] Timeout. Sin red disponible.");
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

void connectWiFi() {
  Serial.print("[WiFi] Conectando a "); Serial.println(g_wifi_ssid);
  WiFi.mode(WIFI_STA);
  WiFi.begin(g_wifi_ssid.c_str(), g_wifi_pass.c_str());
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_CONNECT_TIMEOUT_MS) {
    delay(400); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\n[WiFi] Conectado — IP: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] No se pudo conectar");
  }
}

bool postToAPI(const String& payload) {
  if (WiFi.status() != WL_CONNECTED) return false;

  for (int attempt = 1; attempt <= HTTP_POST_RETRIES; attempt++) {
    HTTPClient http;
    http.setTimeout(HTTP_POST_TIMEOUT_MS);
    http.begin(g_api_url);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", "Bearer " + g_api_token);

    int code = http.POST(payload);
    bool ok  = (code >= 200 && code < 300);
    Serial.printf("[POST] intento %d/%d — HTTP %d — %s\n", attempt, HTTP_POST_RETRIES, code, ok ? "OK" : "FAIL");
    if (!ok) Serial.println(http.getString());
    http.end();

    if (ok) return true;
    if (attempt < HTTP_POST_RETRIES) delay(HTTP_RETRY_DELAY_MS);
  }
  return false;
}

// =============================================
// Relay de comandos desde la plataforma al emisor
//
// Flujo:
//   1. POST de telemetría exitoso
//   2. GET /api/relay/?token=...&emitter=<device_id>
//   3. API devuelve lista de comandos pendientes y los marca como "relayed"
//   4. Receptor los envía por LoRa al emisor
//   5. Emisor los recibe en su ventana de escucha (~CMD_WINDOW_MS tras su TX)
// =============================================
void checkAndRelayCommands(const String& emitterDeviceId) {
  if (WiFi.status() != WL_CONNECTED) return;

  String relayUrl = g_api_url;
  relayUrl.replace("api/telemetry/", "api/relay/");
  relayUrl += "?token=" + g_api_token + "&emitter=" + emitterDeviceId;

  HTTPClient http;
  http.setTimeout(HTTP_RELAY_TIMEOUT_MS);
  if (!http.begin(relayUrl)) {
    Serial.println("[RELAY] begin() failed");
    return;
  }
  int code = http.GET();

  if (code != 200) {
    Serial.printf("[RELAY] HTTP %d\n", code);
    http.end();
    return;
  }

  String body = http.getString();
  http.end();

  StaticJsonDocument<512> relayDoc;
  if (deserializeJson(relayDoc, body)) {
    Serial.println("[RELAY] JSON invalido");
    return;
  }

  JsonArray cmds = relayDoc["commands"].as<JsonArray>();
  int count = cmds.size();

  if (count == 0) {
    Serial.println("[RELAY] Sin comandos pendientes");
    return;
  }

  Serial.printf("[RELAY] %d comando(s) para %s\n", count, emitterDeviceId.c_str());

  for (JsonObject cmd : cmds) {
    StaticJsonDocument<256> loraCmd;
    loraCmd["target"] = emitterDeviceId;
    loraCmd["cmd_id"] = cmd["cmd_id"].as<int>();
    loraCmd["type"]   = cmd["type"].as<const char*>();
    loraCmd["params"] = cmd["params"].as<JsonObject>();

    String loraCmdStr;
    serializeJson(loraCmd, loraCmdStr);

    if (loraCmdStr.length() > RH_RF95_MAX_MESSAGE_LEN - 1) {
      Serial.println("[RELAY] Comando demasiado largo — omitido");
      continue;
    }

    Serial.printf("[RELAY] TX: %s\n", loraCmdStr.c_str());
    delay(150);
    rf95.send((uint8_t*)loraCmdStr.c_str(), loraCmdStr.length());
    rf95.waitPacketSent();
    delay(100);
  }
}

// =====================
// Setup
// =====================
void setup() {
  Serial.begin(115200);
  delay(600);

  Serial.println("\n==============================");
  Serial.println("   RECEPTOR — AgroESP32");
  Serial.println("==============================");

  loadConfig();
  connectWiFi();

  SPI.begin(LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_CS_PIN);
  loraHardReset();

  if (!rf95.init()) {
    Serial.println("[LoRa] Init failed. Reiniciando en 5s...");
    delay(5000); ESP.restart();
  }
  if (!rf95.setFrequency(LORA_FREQ_MHZ)) {
    Serial.println("[LoRa] Freq failed. Reiniciando en 5s...");
    delay(5000); ESP.restart();
  }

  rf95.setTxPower(LORA_TX_DBM, false);
  Serial.printf("[LoRa] Escuchando @ %.0f MHz\n", LORA_FREQ_MHZ);
}

// =====================
// Loop
// =====================
void loop() {
  static unsigned long lastWiFiTry = 0;
  if (WiFi.status() != WL_CONNECTED && millis() - lastWiFiTry > WIFI_RETRY_MS) {
    lastWiFiTry = millis();
    connectWiFi();
  }

  if (!rf95.available()) return;

  uint8_t buf[RH_RF95_MAX_MESSAGE_LEN];
  uint8_t len = sizeof(buf);
  if (!rf95.recv(buf, &len)) return;

  String payload((char*)buf, len);
  int rssi = rf95.lastRssi();
  Serial.printf("\n[RX] %d bytes | RSSI %d dBm\n", len, rssi);
  Serial.println(payload);

  StaticJsonDocument<128> idDoc;
  deserializeJson(idDoc, payload);
  String emitterDeviceId = idDoc["device_id"] | "";

  DynamicJsonDocument doc(768);
  if (deserializeJson(doc, payload)) {
    Serial.println("[RX] JSON invalido — descartado");
    return;
  }
  doc["rssi"] = rssi;
  String payloadWithRssi;
  serializeJson(doc, payloadWithRssi);

  bool ok = postToAPI(payloadWithRssi);
  Serial.println(ok ? "[POST] OK" : "[POST] FALLO — dato perdido");

  // Relay de comandos: el emisor tiene CMD_WINDOW_MS de ventana de escucha.
  // El POST con reintentos puede tardar hasta ~6s. Hay margen con 7s de ventana.
  if (ok && emitterDeviceId.length() > 0) {
    checkAndRelayCommands(emitterDeviceId);
  }
}
