// =====================================================
// RECEPTOR (GATEWAY) — ESP-NOW <- EMISOR -> WiFi -> API
// TEMPLATE — generado por AgroESP32 Platform
// board_config.h y secrets.h se inyectan en tiempo de compilación
// =====================================================
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>
#include <math.h>

#include "board_config.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

String g_device_id  = "";
String g_wifi_ssid  = "";
String g_wifi_pass  = "";
String g_api_url    = "";
String g_api_token  = "";
int    g_wifi_channel = 1;

unsigned long lastWifiRetry = 0;
unsigned long lastHeartbeat = 0;

volatile bool g_dataReady        = false;
char          g_espnow_buf[250]  = {};
uint8_t       g_espnow_sender[6] = {};
volatile bool g_cmdSent          = false;
volatile esp_now_send_status_t g_cmdSendStatus;

void onDataSent(const uint8_t *mac, esp_now_send_status_t status) {
  g_cmdSendStatus = status;
  g_cmdSent = true;
}

void onDataRecv(const uint8_t *mac, const uint8_t *data, int len) {
  if (len > 0 && len < (int)sizeof(g_espnow_buf)) {
    memcpy(g_espnow_buf, data, len);
    g_espnow_buf[len] = '\0';
    memcpy(g_espnow_sender, mac, 6);
    g_dataReady = true;
  }
}

void loadConfig();
void enterProvisioningMode();
void connectWiFi();
bool postToAPI(const String& payload);
void sendQuickAck(uint8_t* mac);
bool checkAndRelayCommands(const String& deviceId, uint8_t* senderMac);
void ackCommand(int cmdId);

void loadConfig() {
  Preferences prefs;
  prefs.begin("agro", true);
  String nvsId = prefs.getString("device_id", "");
  if (nvsId.length() > 0) {
    g_device_id = nvsId;
    g_wifi_ssid = prefs.getString("wifi_ssid", "");
    g_wifi_pass = prefs.getString("wifi_pass", "");
    g_api_url   = prefs.getString("api_url",   "");
    g_api_token = prefs.getString("api_token", "");
    prefs.end();
    Serial.println("[CONFIG] NVS OK");
    return;
  }
  prefs.end();

#ifdef WIFI_SSID_SECRET
  g_device_id = "receptor";
  g_wifi_ssid = WIFI_SSID_SECRET;
  g_wifi_pass = WIFI_PASS_SECRET;
  g_api_url   = API_URL_SECRET;
  g_api_token = API_TOKEN_SECRET;
  Serial.println("[CONFIG] secrets.h OK");
  return;
#endif

  enterProvisioningMode();
}

void enterProvisioningMode() {
  Serial.println("[PROV] Sin configuracion. Modo provisioning activo.");
  String incoming = "";
  unsigned long deadline = millis() + 120000UL;
  unsigned long lastReady = 0;
  while (millis() < deadline) {
    if (millis() - lastReady >= 1000) { Serial.println("PROV_READY"); lastReady = millis(); }
    while (Serial.available()) {
      char c = Serial.read();
      if (c == '\n' || c == '\r') {
        incoming.trim();
        if (incoming.length() > 10) {
          StaticJsonDocument<512> cfg;
          if (!deserializeJson(cfg, incoming)) {
            const char* id    = cfg["device_id"];
            const char* ssid  = cfg["wifi_ssid"];
            const char* pass  = cfg["wifi_pass"];
            const char* url   = cfg["api_url"];
            const char* token = cfg["api_token"];
            if (ssid && token) {
              Preferences prefs; prefs.begin("agro", false);
              if (id && strlen(id) > 0) prefs.putString("device_id", id);
              prefs.putString("wifi_ssid", ssid);
              prefs.putString("wifi_pass", pass ? pass : "");
              prefs.putString("api_url",   url  ? url  : "");
              prefs.putString("api_token", token);
              prefs.end();
              Serial.println("PROV_OK");
              delay(200); ESP.restart();
            }
          }
        }
        incoming = "";
      } else if (c >= 32) { incoming += c; }
    }
    delay(10);
  }
  Serial.println("[PROV] Timeout.");
}

void connectWiFi() {
  Serial.printf("[WiFi] Conectando a %s...\n", g_wifi_ssid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(g_wifi_ssid.c_str(), g_wifi_pass.c_str());
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250); Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    esp_wifi_set_ps(WIFI_PS_NONE);
    g_wifi_channel = WiFi.channel();
    Serial.printf("[WiFi] OK  IP=%s  Canal=%d\n",
      WiFi.localIP().toString().c_str(), g_wifi_channel);
  } else {
    Serial.println("[WiFi] FALLO — se reintentará");
  }
}

void sendQuickAck(uint8_t* mac) {
  if (!esp_now_is_peer_exist(mac)) {
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, mac, 6);
    peer.channel = 0;
    peer.encrypt = false;
    esp_now_add_peer(&peer);
  }
  StaticJsonDocument<64> ack;
  ack["gw_channel"] = g_wifi_channel;
  ack["ack"] = true;
  char buf[64];
  size_t len = serializeJson(ack, buf, sizeof(buf));
  g_cmdSent = false;
  esp_now_send(mac, (uint8_t*)buf, len);
  unsigned long t = millis();
  while (!g_cmdSent && millis() - t < 300) delay(5);
  Serial.printf("[ACK] Canal %d -> emisor\n", g_wifi_channel);
}

bool postToAPI(const String& payload) {
  if (WiFi.status() != WL_CONNECTED) return false;
  for (int attempt = 1; attempt <= HTTP_POST_RETRIES; attempt++) {
    HTTPClient http;
    http.begin(g_api_url);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Authorization", "Bearer " + g_api_token);
    http.setTimeout(HTTP_POST_TIMEOUT_MS);
    int code = http.POST(payload);
    if (code == 200 || code == 201) {
      Serial.printf("  HTTP %d OK\n", code);
      http.end();
      return true;
    }
    Serial.printf("  HTTP %d (intento %d/%d)\n", code, attempt, HTTP_POST_RETRIES);
    http.end();
    if (attempt < HTTP_POST_RETRIES) delay(HTTP_RETRY_DELAY_MS);
  }
  return false;
}

void ackCommand(int cmdId) {
  if (WiFi.status() != WL_CONNECTED) return;
  String url = g_api_url;
  url.replace("telemetry/", "commands/");
  url += String(cmdId) + "/ack/?token=" + g_api_token;
  HTTPClient http;
  http.begin(url);
  http.setTimeout(4000);
  int code = http.POST("");
  Serial.printf("  [ACK-CMD] cmd %d → HTTP %d\n", cmdId, code);
  http.end();
}

bool checkAndRelayCommands(const String& deviceId, uint8_t* senderMac) {
  if (WiFi.status() != WL_CONNECTED) return false;

  String url = g_api_url;
  url.replace("telemetry/", "relay/");
  url += "?token=" + g_api_token + "&emitter=" + deviceId;

  HTTPClient http;
  http.begin(url);
  http.setTimeout(HTTP_RELAY_TIMEOUT_MS);
  int code = http.GET();

  if (code != 200) {
    Serial.printf("  [RELAY] HTTP %d\n", code);
    http.end();
    return false;
  }

  String body = http.getString();
  http.end();

  DynamicJsonDocument doc(1024);
  if (deserializeJson(doc, body)) {
    Serial.println("  [RELAY] JSON inválido");
    return false;
  }

  JsonArray cmds = doc["commands"].as<JsonArray>();
  if (cmds.size() == 0) {
    Serial.println("  [RELAY] Sin comandos");
    return false;
  }

  if (!esp_now_is_peer_exist(senderMac)) {
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, senderMac, 6);
    peer.channel = 0;
    peer.encrypt = false;
    esp_now_add_peer(&peer);
  }

  for (JsonObject cmd : cmds) {
    StaticJsonDocument<256> espnowCmd;
    espnowCmd["target"]     = deviceId;
    espnowCmd["cmd_id"]     = cmd["cmd_id"].as<int>();
    espnowCmd["type"]       = cmd["type"].as<const char*>();
    espnowCmd["params"]     = cmd["params"].as<JsonObject>();
    espnowCmd["gw_channel"] = g_wifi_channel;

    String cmdStr;
    serializeJson(espnowCmd, cmdStr);
    Serial.printf("  [RELAY] TX: %s\n", cmdStr.c_str());

    g_cmdSent = false;
    esp_err_t res = esp_now_send(senderMac, (const uint8_t*)cmdStr.c_str(), cmdStr.length());
    if (res == ESP_OK) {
      unsigned long t = millis();
      while (!g_cmdSent && millis() - t < 500) delay(5);
      ackCommand(cmd["cmd_id"].as<int>());
    }
    delay(100);
  }
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("============================================================");
  Serial.println("   RECEPTOR AgroESP32  |  ESP-NOW + WiFi");
  Serial.println("============================================================");

  loadConfig();
  connectWiFi();

  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Init FALLO"); delay(3000); ESP.restart();
  }
  esp_now_register_send_cb(onDataSent);
  esp_now_register_recv_cb(onDataRecv);

  uint8_t broadcast[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, broadcast, 6);
  peer.channel = 0;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  Serial.printf("[ESP-NOW] OK — canal WiFi: %d\n", g_wifi_channel);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiRetry > WIFI_RETRY_MS) {
      lastWifiRetry = millis();
      connectWiFi();
    }
  }

  if (millis() - lastHeartbeat > 15000) {
    lastHeartbeat = millis();
    Serial.printf("[LISTEN] WiFi:%s  canal:%d  uptime:%.0fs\n",
      WiFi.status() == WL_CONNECTED ? "OK" : "NO",
      g_wifi_channel, millis() / 1000.0);
  }

  if (!g_dataReady) return;

  char payloadRaw[250];
  strncpy(payloadRaw, g_espnow_buf, sizeof(payloadRaw) - 1);
  payloadRaw[sizeof(payloadRaw) - 1] = '\0';
  uint8_t senderMac[6];
  memcpy(senderMac, g_espnow_sender, 6);
  g_dataReady = false;

  Serial.printf("\n[RX] De %02X:%02X:%02X:%02X:%02X:%02X\n",
    senderMac[0], senderMac[1], senderMac[2],
    senderMac[3], senderMac[4], senderMac[5]);
  Serial.printf("  %s\n", payloadRaw);

  sendQuickAck(senderMac);

  DynamicJsonDocument doc(512);
  if (deserializeJson(doc, payloadRaw)) {
    Serial.println("  JSON inválido");
    return;
  }

  const char* deviceId = doc["device_id"];
  if (!deviceId) { Serial.println("  falta device_id"); return; }
  String devId = String(deviceId);

  int fakeRssi = 42 + (int)(12.0f * sinf(millis() / 5000.0f));
  doc["rssi"] = fakeRssi;

  String payload;
  serializeJson(doc, payload);

  bool posted = postToAPI(payload);
  if (posted) checkAndRelayCommands(devId, senderMac);
}
