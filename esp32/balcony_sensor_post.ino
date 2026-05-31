#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

const char* serverUrl = "https://YOUR_VERCEL_DOMAIN/api/sensor-readings";
const char* deviceToken = "YOUR_DEVICE_API_TOKEN";

// TODO: 실제 센서 핀/라이브러리에 맞게 교체하세요.
float readTemperatureC() {
  return 23.4;
}

float readHumidityPct() {
  return 61.2;
}

int readLightLux() {
  return 830;
}

float readSoilMoisturePct() {
  return 36.0;
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }
}

void postSensorReading() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", deviceToken);

  String payload = "{";
  payload += "\"location\":\"베란다\",";
  payload += "\"device_id\":\"esp32-balcony-01\",";
  payload += "\"temperature_c\":" + String(readTemperatureC(), 1) + ",";
  payload += "\"humidity_pct\":" + String(readHumidityPct(), 1) + ",";
  payload += "\"light_lux\":" + String(readLightLux()) + ",";
  payload += "\"soil_moisture_pct\":" + String(readSoilMoisturePct(), 1);
  payload += "}";

  int statusCode = http.POST(payload);
  Serial.print("POST status: ");
  Serial.println(statusCode);
  Serial.println(http.getString());
  http.end();
}

void setup() {
  Serial.begin(115200);
  connectWifi();
  postSensorReading();
}

void loop() {
  postSensorReading();
  delay(60000);
}
