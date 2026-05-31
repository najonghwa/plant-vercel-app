#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

const char* commandUrl = "https://YOUR_VERCEL_DOMAIN/api/pump-commands?device_id=pump-balcony-01";
const char* patchUrl = "https://YOUR_VERCEL_DOMAIN/api/pump-commands";
const char* deviceToken = "YOUR_DEVICE_API_TOKEN";

const int relayPin = 26;

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

void patchCommand(String commandId, String status) {
  HTTPClient http;
  http.begin(patchUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", deviceToken);

  String payload = "{\"command_id\":\"" + commandId + "\",\"status\":\"" + status + "\"}";
  http.PATCH(payload);
  http.end();
}

// 간단 예시입니다. 실제 적용 전에는 ArduinoJson으로 JSON 파싱을 교체하세요.
String extractJsonString(String body, String key) {
  String needle = "\"" + key + "\":\"";
  int start = body.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  int end = body.indexOf("\"", start);
  return body.substring(start, end);
}

int extractJsonInt(String body, String key) {
  String needle = "\"" + key + "\":";
  int start = body.indexOf(needle);
  if (start < 0) return 0;
  start += needle.length();
  int end = body.indexOf(",", start);
  if (end < 0) end = body.indexOf("}", start);
  return body.substring(start, end).toInt();
}

void pollAndRunPump() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  HTTPClient http;
  http.begin(commandUrl);
  http.addHeader("x-device-token", deviceToken);

  int statusCode = http.GET();
  String body = http.getString();
  http.end();

  if (statusCode != 200 || body.indexOf("\"commands\":[]") >= 0) {
    return;
  }

  String commandId = extractJsonString(body, "id");
  int seconds = extractJsonInt(body, "watering_seconds");

  if (commandId == "" || seconds <= 0 || seconds > 30) {
    return;
  }

  patchCommand(commandId, "running");
  digitalWrite(relayPin, HIGH);
  delay(seconds * 1000);
  digitalWrite(relayPin, LOW);
  patchCommand(commandId, "completed");
}

void setup() {
  Serial.begin(115200);
  pinMode(relayPin, OUTPUT);
  digitalWrite(relayPin, LOW);
  connectWifi();
}

void loop() {
  pollAndRunPump();
  delay(15000);
}
