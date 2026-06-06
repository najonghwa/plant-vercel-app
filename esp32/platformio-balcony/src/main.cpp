#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <BH1750.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

#include "config.h"

const char *sensorPostUrl = "https://plant-vercel-app.vercel.app/api/sensor-readings";
const char *pumpCommandUrl = "https://plant-vercel-app.vercel.app/api/pump-commands?device_id=pump-balcony-01";
const char *pumpPatchUrl = "https://plant-vercel-app.vercel.app/api/pump-commands";

const char *locationName = "\uBCA0\uB780\uB2E4";
const char *sensorDeviceId = "esp32-balcony-01";

BH1750 lightMeter;
Adafruit_BME280 bme;
WebServer server(80);

float lux = 0;
float temperature = 0;
float humidity = 0;
float pressure = 0;

const int moisturePin = 34;
const int moisturePowerPin = -1; // Optional: set to a GPIO if you power the soil sensor through a transistor/MOSFET.
int moistureRaw = 0;
int moisturePercent = 0;

const int dryValue = 3200;
const int wetValue = 1200;

const int relayPin = 26;
const bool relayActiveHigh = false;
const bool pumpWiringTestOnBoot = true;
const int pumpWiringTestSeconds = 10;

unsigned long lastCloudPostAt = 0;
unsigned long lastPumpPollAt = 0;
unsigned long lastSensorReadAt = 0;
unsigned long bootedAt = 0;
bool pumpWiringTestDone = false;
const unsigned long sensorReadIntervalMs = 30000;
const unsigned long cloudPostIntervalMs = 600000;
const unsigned long pumpPollIntervalMs = 120000;

void relayWrite(bool on) {
  digitalWrite(relayPin, relayActiveHigh ? (on ? HIGH : LOW) : (on ? LOW : HIGH));
}

void runPumpWiringTest() {
  if (!pumpWiringTestOnBoot || pumpWiringTestDone) return;
  pumpWiringTestDone = true;

  Serial.print("Pump wiring test: ON ");
  Serial.print(pumpWiringTestSeconds);
  Serial.println(" seconds");
  relayWrite(true);
  delay((unsigned long)pumpWiringTestSeconds * 1000);
  relayWrite(false);
  Serial.println("Pump wiring test: OFF");
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi connecting");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected");
  Serial.print("ESP32 IP address: ");
  Serial.println(WiFi.localIP());
}

String jsonStringValue(const String &body, const String &key) {
  String needle = "\"" + key + "\":\"";
  int start = body.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  int end = body.indexOf("\"", start);
  if (end < 0) return "";
  return body.substring(start, end);
}

int jsonIntValue(const String &body, const String &key) {
  String needle = "\"" + key + "\":";
  int start = body.indexOf(needle);
  if (start < 0) return 0;
  start += needle.length();
  int endComma = body.indexOf(",", start);
  int endBrace = body.indexOf("}", start);
  int end = endComma >= 0 ? endComma : endBrace;
  if (end < 0) return 0;
  return body.substring(start, end).toInt();
}

void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Plant Sensor Monitor</title>
</head>
<body style="font-family:Arial; text-align:center;">
<h1>Plant Sensor Monitor</h1>
<h2 id="lux">Light: -- lx</h2>
<h2 id="moisture">Soil moisture: -- %</h2>
<h3 id="raw">Raw: --</h3>
<h2 id="temp">Temperature: -- C</h2>
<h2 id="humidity">Humidity: -- %</h2>
<h2 id="pressure">Pressure: -- hPa</h2>
<script>
async function updateData() {
  try {
    const res = await fetch('/data');
    const json = await res.json();
    document.getElementById('lux').innerText = 'Light: ' + json.lux + ' lx';
    document.getElementById('moisture').innerText = 'Soil moisture: ' + json.moisture + ' %';
    document.getElementById('raw').innerText = 'Raw: ' + json.raw;
    document.getElementById('temp').innerText = 'Temperature: ' + json.temp + ' C';
    document.getElementById('humidity').innerText = 'Humidity: ' + json.humidity + ' %';
    document.getElementById('pressure').innerText = 'Pressure: ' + json.pressure + ' hPa';
  } catch(e) {
    console.log(e);
  }
}
setInterval(updateData, 10000);
updateData();
</script>
</body>
</html>
)rawliteral";

  server.send(200, "text/html; charset=UTF-8", html);
}

void handleData() {
  String json = "{";
  json += "\"lux\":" + String(lux, 1) + ",";
  json += "\"raw\":" + String(moistureRaw) + ",";
  json += "\"moisture\":" + String(moisturePercent) + ",";
  json += "\"temp\":" + String(temperature, 1) + ",";
  json += "\"humidity\":" + String(humidity, 1) + ",";
  json += "\"pressure\":" + String(pressure, 1);
  json += "}";

  server.send(200, "application/json", json);
}

void setMoistureSensorPower(bool on) {
  if (moisturePowerPin < 0) return;
  digitalWrite(moisturePowerPin, on ? HIGH : LOW);
}

int readMoistureRaw() {
  setMoistureSensorPower(true);
  delay(250);

  long total = 0;
  const int samples = 8;
  for (int i = 0; i < samples; i++) {
    total += analogRead(moisturePin);
    delay(20);
  }

  setMoistureSensorPower(false);
  return total / samples;
}

void readSensors() {
  lux = lightMeter.readLightLevel();
  temperature = bme.readTemperature();
  humidity = bme.readHumidity();
  pressure = bme.readPressure() / 100.0F;

  moistureRaw = readMoistureRaw();
  moisturePercent = map(moistureRaw, dryValue, wetValue, 0, 100);
  moisturePercent = constrain(moisturePercent, 0, 100);

  Serial.print("Lux:");
  Serial.print(lux);
  Serial.print(" | Moisture:");
  Serial.print(moisturePercent);
  Serial.print("% | Raw:");
  Serial.print(moistureRaw);
  Serial.print(" | Temp:");
  Serial.print(temperature, 1);
  Serial.print("C | Humidity:");
  Serial.print(humidity, 1);
  Serial.print("% | Pressure:");
  Serial.println(pressure, 1);
}

void postSensorReading() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();

  HTTPClient http;
  http.begin(sensorPostUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_API_TOKEN);

  String payload = "{";
  payload += "\"location\":\"" + String(locationName) + "\",";
  payload += "\"device_id\":\"" + String(sensorDeviceId) + "\",";
  payload += "\"temperature_c\":" + String(temperature, 1) + ",";
  payload += "\"humidity_pct\":" + String(humidity, 1) + ",";
  payload += "\"light_lux\":" + String((int)round(lux)) + ",";
  payload += "\"soil_moisture_pct\":" + String(moisturePercent);
  payload += "}";

  int code = http.POST(payload);
  Serial.print("Sensor POST status: ");
  Serial.println(code);
  Serial.println(http.getString());
  http.end();
}

void patchPumpCommand(const String &commandId, const String &status) {
  HTTPClient http;
  http.begin(pumpPatchUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", DEVICE_API_TOKEN);

  String payload = "{\"command_id\":\"" + commandId + "\",\"status\":\"" + status + "\"}";
  int code = http.sendRequest("PATCH", payload);
  Serial.print("Pump PATCH ");
  Serial.print(status);
  Serial.print(" status: ");
  Serial.println(code);
  Serial.println(http.getString());
  http.end();
}

void pollPumpCommands() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();

  HTTPClient http;
  http.begin(pumpCommandUrl);
  http.addHeader("x-device-token", DEVICE_API_TOKEN);

  int code = http.GET();
  Serial.print("Pump GET status: ");
  Serial.println(code);
  String body = http.getString();
  Serial.println(body);
  http.end();

  if (code != 200) return;

  String commandId = jsonStringValue(body, "id");
  int wateringSeconds = jsonIntValue(body, "watering_seconds");
  if (commandId.length() == 0 || wateringSeconds <= 0) return;
  wateringSeconds = constrain(wateringSeconds, 1, 20);

  patchPumpCommand(commandId, "running");
  relayWrite(true);
  delay((unsigned long)wateringSeconds * 1000);
  relayWrite(false);
  patchPumpCommand(commandId, "completed");
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin(21, 22);
  lightMeter.begin();

  if (!bme.begin(0x76)) {
    Serial.println("BME280 not found at 0x76. Try checking wiring or address 0x77.");
  }

  pinMode(moisturePin, INPUT);
  if (moisturePowerPin >= 0) {
    pinMode(moisturePowerPin, OUTPUT);
    setMoistureSensorPower(false);
  }
  pinMode(relayPin, OUTPUT);
  relayWrite(false);

  connectWifi();

  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.begin();
  Serial.println("Web server started");

  readSensors();
  postSensorReading();
  pollPumpCommands();

  unsigned long now = millis();
  bootedAt = now;
  lastSensorReadAt = now;
  lastCloudPostAt = now;
  lastPumpPollAt = now;
}

void loop() {
  server.handleClient();

  unsigned long now = millis();
  if (!pumpWiringTestDone && now - bootedAt >= 5000) {
    runPumpWiringTest();
  }

  if (now - lastSensorReadAt >= sensorReadIntervalMs) {
    readSensors();
    lastSensorReadAt = now;
  }

  if (now - lastCloudPostAt >= cloudPostIntervalMs) {
    postSensorReading();
    lastCloudPostAt = now;
  }

  if (now - lastPumpPollAt >= pumpPollIntervalMs) {
    pollPumpCommands();
    lastPumpPollAt = now;
  }

  delay(20);
}
