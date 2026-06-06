#include <WiFi.h>
#include <Wire.h>
#include <BH1750.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

const char* sensorPostUrl = "https://plant-vercel-app.vercel.app/api/sensor-readings";
const char* pumpCommandUrl = "https://plant-vercel-app.vercel.app/api/pump-commands?device_id=pump-balcony-01";
const char* pumpPatchUrl = "https://plant-vercel-app.vercel.app/api/pump-commands";
const char* deviceToken = "YOUR_DEVICE_API_TOKEN";

const char* locationName = "베란다";
const char* sensorDeviceId = "esp32-balcony-01";
const char* pumpDeviceId = "pump-balcony-01";

BH1750 lightMeter;
Adafruit_BME280 bme;
WebServer server(80);

float lux = 0;
float temperature = 0;
float humidity = 0;
float pressure = 0;

const int moisturePin = 34;
int moistureRaw = 0;
int moisturePercent = 0;

const int dryValue = 3000;
const int wetValue = 1200;

const int relayPin = 26;
const bool relayActiveHigh = true;

unsigned long lastCloudPostAt = 0;
unsigned long lastPumpPollAt = 0;
const unsigned long cloudPostIntervalMs = 60000;
const unsigned long pumpPollIntervalMs = 15000;

void relayWrite(bool on) {
  digitalWrite(relayPin, relayActiveHigh ? (on ? HIGH : LOW) : (on ? LOW : HIGH));
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("WiFi connecting");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi connected!");
  Serial.print("ESP32 IP address: ");
  Serial.println(WiFi.localIP());
}

String jsonStringValue(String body, String key) {
  String needle = "\"" + key + "\":\"";
  int start = body.indexOf(needle);
  if (start < 0) return "";
  start += needle.length();
  int end = body.indexOf("\"", start);
  if (end < 0) return "";
  return body.substring(start, end);
}

int jsonIntValue(String body, String key) {
  String needle = "\"" + key + "\":";
  int start = body.indexOf(needle);
  if (start < 0) return 0;
  start += needle.length();
  int end = body.indexOf(",", start);
  if (end < 0) end = body.indexOf("}", start);
  if (end < 0) return 0;
  return body.substring(start, end).toInt();
}

void postSensorToCloud() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  HTTPClient http;
  http.begin(sensorPostUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", deviceToken);

  String payload = "{";
  payload += "\"location\":\"" + String(locationName) + "\",";
  payload += "\"device_id\":\"" + String(sensorDeviceId) + "\",";
  payload += "\"temperature_c\":" + String(temperature, 1) + ",";
  payload += "\"humidity_pct\":" + String(humidity, 1) + ",";
  payload += "\"light_lux\":" + String(lux, 0) + ",";
  payload += "\"soil_moisture_pct\":" + String(moisturePercent);
  payload += "}";

  int statusCode = http.POST(payload);
  Serial.print("Sensor POST status: ");
  Serial.println(statusCode);
  Serial.println(http.getString());
  http.end();
}

void patchPumpCommand(String commandId, String status) {
  HTTPClient http;
  http.begin(pumpPatchUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-token", deviceToken);

  String payload = "{\"command_id\":\"" + commandId + "\",\"status\":\"" + status + "\"}";
  int statusCode = http.PATCH(payload);
  Serial.print("Pump PATCH ");
  Serial.print(status);
  Serial.print(": ");
  Serial.println(statusCode);
  http.end();
}

void pollPumpCommand() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  HTTPClient http;
  http.begin(pumpCommandUrl);
  http.addHeader("x-device-token", deviceToken);

  int statusCode = http.GET();
  String body = http.getString();
  http.end();

  if (statusCode != 200) {
    Serial.print("Pump GET status: ");
    Serial.println(statusCode);
    return;
  }

  if (body.indexOf("\"commands\":[]") >= 0) {
    return;
  }

  String commandId = jsonStringValue(body, "id");
  int wateringSeconds = jsonIntValue(body, "watering_seconds");

  if (commandId == "" || wateringSeconds <= 0 || wateringSeconds > 30) {
    return;
  }

  Serial.print("Run pump command ");
  Serial.print(commandId);
  Serial.print(" for ");
  Serial.print(wateringSeconds);
  Serial.println("s");

  patchPumpCommand(commandId, "running");
  relayWrite(true);
  delay(wateringSeconds * 1000);
  relayWrite(false);
  patchPumpCommand(commandId, "completed");
}

void readSensors() {
  lux = lightMeter.readLightLevel();
  temperature = bme.readTemperature();
  humidity = bme.readHumidity();
  pressure = bme.readPressure() / 100.0F;

  moistureRaw = analogRead(moisturePin);
  moisturePercent = map(moistureRaw, dryValue, wetValue, 0, 100);
  moisturePercent = constrain(moisturePercent, 0, 100);
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
<h1>식물 센서 모니터</h1>
<h2 id="lux">조도: -- lx</h2>
<canvas id="lightChart" width="360" height="200" style="border:1px solid #ccc;"></canvas>
<h2 id="moisture">수분: -- %</h2>
<h3 id="raw">Raw: --</h3>
<canvas id="moistureChart" width="360" height="200" style="border:1px solid #ccc;"></canvas>
<h2 id="temp">온도: -- °C</h2>
<h2 id="humidity">습도: -- %</h2>
<h2 id="pressure">기압: -- hPa</h2>
<script>
let lightData = [];
let moistureData = [];
async function updateData() {
  try {
    const res = await fetch('/data');
    const json = await res.json();
    document.getElementById('lux').innerText = '조도: ' + json.lux + ' lx';
    document.getElementById('moisture').innerText = '수분: ' + json.moisture + ' %';
    document.getElementById('raw').innerText = 'Raw: ' + json.raw;
    document.getElementById('temp').innerText = '온도: ' + json.temp + ' °C';
    document.getElementById('humidity').innerText = '습도: ' + json.humidity + ' %';
    document.getElementById('pressure').innerText = '기압: ' + json.pressure + ' hPa';
    lightData.push(json.lux);
    moistureData.push(json.moisture);
    if (lightData.length > 60) lightData.shift();
    if (moistureData.length > 60) moistureData.shift();
    drawChart('lightChart', lightData, '조도 lx');
    drawChart('moistureChart', moistureData, '수분 %');
  } catch(e) {
    console.log(e);
  }
}
function drawChart(canvasId, data, label) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.moveTo(30, 10);
  ctx.lineTo(30, h - 30);
  ctx.lineTo(w - 10, h - 30);
  ctx.stroke();
  ctx.fillText(label, 35, 15);
  if (data.length < 2) return;
  let maxVal = Math.max(...data, 10);
  let minVal = Math.min(...data, 0);
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    let x = 30 + i * ((w - 50) / 59);
    let y = (h - 30) - ((data[i] - minVal) / (maxVal - minVal + 1)) * (h - 50);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillText('max:' + maxVal.toFixed(1), 35, 30);
  ctx.fillText('min:' + minVal.toFixed(1), 35, h - 10);
}
setInterval(updateData, 1000);
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

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(relayPin, OUTPUT);
  relayWrite(false);

  Wire.begin(21, 22);
  lightMeter.begin();

  if (!bme.begin(0x76)) {
    Serial.println("BME280 not found!");
    Serial.println("Try address 0x77");
  }

  pinMode(moisturePin, INPUT);
  connectWifi();

  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.begin();
  Serial.println("Web server started");
}

void loop() {
  readSensors();

  Serial.print("Lux:");
  Serial.print(lux);
  Serial.print(" | Moisture:");
  Serial.print(moisturePercent);
  Serial.print("% | Raw:");
  Serial.print(moistureRaw);
  Serial.print(" | Temp:");
  Serial.print(temperature);
  Serial.print("C | Humidity:");
  Serial.print(humidity);
  Serial.print("% | Pressure:");
  Serial.println(pressure);

  server.handleClient();

  unsigned long now = millis();
  if (now - lastCloudPostAt >= cloudPostIntervalMs) {
    lastCloudPostAt = now;
    postSensorToCloud();
  }

  if (now - lastPumpPollAt >= pumpPollIntervalMs) {
    lastPumpPollAt = now;
    pollPumpCommand();
  }

  delay(200);
}
