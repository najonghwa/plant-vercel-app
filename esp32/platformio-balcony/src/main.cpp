#include <Arduino.h>
#include <WiFi.h>
#include <Wire.h>
#include <BH1750.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

#include "config.h"

// ─────────────────────────────────────────────────────────────
// 서버 엔드포인트
// ─────────────────────────────────────────────────────────────
const char *sensorPostUrl   = "https://plant-vercel-app.vercel.app/api/sensor-readings";
const char *pumpCommandUrl   = "https://plant-vercel-app.vercel.app/api/pump-commands?device_id=pump-balcony-01";
const char *pumpPatchUrl     = "https://plant-vercel-app.vercel.app/api/pump-commands";

const char *locationName   = "베란다"; // UTF-8, 서버의 위치값 "베란다"와 일치해야 함
const char *sensorDeviceId = "esp32-balcony-01";

// ─────────────────────────────────────────────────────────────
// 릴레이 / 펌프 설정  ★ 가장 중요한 부분 ★
// ─────────────────────────────────────────────────────────────
// relayPin           : 릴레이 모듈 IN 핀이 꽂힌 GPIO
// relayActiveHigh     : 릴레이가 어떤 신호에서 "켜지는지".
//                       파란색 1채널 릴레이 모듈은 보통 active-LOW (LOW일 때 코일 ON) → false.
//                       만약 반대로 동작하면 이 값만 true 로 바꾸면 됨.
// maxPumpSeconds      : 안전장치. 펌프가 어떤 이유로도 이 시간보다 길게 켜지지 않도록 강제 차단.
//
// ※ 하드웨어 배선(꼭 확인):
//   펌프 전선은 릴레이의  COM ↔ NO  접점을 통해 연결해야 한다.
//     - 릴레이 OFF → NO 끊김  → 펌프 OFF (전원 들어와도 기본 꺼짐, 안전)
//     - 릴레이 ON  → NO 붙음  → 펌프 ON  (급수할 때만)
//   펌프를 NC(평상시 연결) 단자에 꽂으면 릴레이 OFF에서도 펌프가 계속 돈다. NC가 아니라 NO 사용!
const int  relayPin        = 26;
const bool relayActiveHigh = false;
const int  maxPumpSeconds  = 15;

// ── 테스트용 토글 모드 ──────────────────────────────────────
// relayToggleTest = true 로 바꾸면, 자동급수 대신 릴레이를
// relayToggleSeconds 초마다 ON/OFF 반복한다. (멀티미터 측정/배선 확인용)
// 측정 끝나면 다시 false 로 바꾸고 업로드할 것.
const bool relayToggleTest    = true;  // ★테스트 중★ 끝나면 false 로 되돌리기
const int  relayToggleSeconds = 5;

// ─────────────────────────────────────────────────────────────
// 센서 핀 / 보정값
// ─────────────────────────────────────────────────────────────
const int moisturePin      = 34;
const int moisturePowerPin = -1; // 토양센서를 트랜지스터로 켜고 끌 때만 GPIO 지정. 아니면 -1.
const int dryValue         = 3200; // 완전 건조(공기 중) 시 raw 값
const int wetValue         = 1200; // 완전 젖음 시 raw 값

// ─────────────────────────────────────────────────────────────
// 주기 설정
// ─────────────────────────────────────────────────────────────
const unsigned long sensorReadIntervalMs = 30000;  // 센서 읽기 30초
const unsigned long cloudPostIntervalMs  = 60000;  // 서버 전송 60초
const unsigned long pumpPollIntervalMs   = 30000;  // 펌프 명령 확인 30초

// ─────────────────────────────────────────────────────────────
// 전역 상태
// ─────────────────────────────────────────────────────────────
BH1750 lightMeter;
Adafruit_BME280 bme;
WebServer server(80);

float lux = 0, temperature = 0, humidity = 0, pressure = 0;
int   moistureRaw = 0, moisturePercent = 0;

unsigned long lastSensorReadAt = 0;
unsigned long lastCloudPostAt  = 0;
unsigned long lastPumpPollAt   = 0;

unsigned long lastToggleAt = 0;
bool          toggleState  = false;

// ─────────────────────────────────────────────────────────────
// 릴레이 제어
// ─────────────────────────────────────────────────────────────
// on=true 면 펌프 ON, false 면 OFF. 극성(relayActiveHigh)에 맞춰 알아서 변환.
void relayWrite(bool on) {
  bool level = relayActiveHigh ? on : !on;
  digitalWrite(relayPin, level ? HIGH : LOW);
}

// ─────────────────────────────────────────────────────────────
// WiFi
// ─────────────────────────────────────────────────────────────
void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi connecting");

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (millis() - startedAt > 20000) { // 20초 안에 안 붙으면 포기(펌프는 계속 OFF 유지)
      Serial.println();
      Serial.println("WiFi connect timeout");
      return;
    }
  }

  Serial.println();
  Serial.print("WiFi connected, IP: ");
  Serial.println(WiFi.localIP());
}

// ─────────────────────────────────────────────────────────────
// 아주 단순한 JSON 파서 (응답에서 첫 값 추출)
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// 로컬 웹페이지(센서 모니터)
// ─────────────────────────────────────────────────────────────
void handleRoot() {
  String html = R"rawliteral(
<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Plant Sensor Monitor</title></head>
<body style="font-family:Arial; text-align:center;">
<h1>Plant Sensor Monitor</h1>
<h2 id="lux">Light: -- lx</h2>
<h2 id="moisture">Soil moisture: -- %</h2>
<h3 id="raw">Raw: --</h3>
<h2 id="temp">Temperature: -- C</h2>
<h2 id="humidity">Humidity: -- %</h2>
<h2 id="pressure">Pressure: -- hPa</h2>
<script>
async function updateData(){try{const r=await fetch('/data');const j=await r.json();
lux.innerText='Light: '+j.lux+' lx';moisture.innerText='Soil moisture: '+j.moisture+' %';
raw.innerText='Raw: '+j.raw;temp.innerText='Temperature: '+j.temp+' C';
humidity.innerText='Humidity: '+j.humidity+' %';pressure.innerText='Pressure: '+j.pressure+' hPa';
}catch(e){console.log(e);}}
setInterval(updateData,10000);updateData();
</script></body></html>
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

// ─────────────────────────────────────────────────────────────
// 센서 읽기
// ─────────────────────────────────────────────────────────────
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
  lux         = lightMeter.readLightLevel();
  temperature = bme.readTemperature();
  humidity    = bme.readHumidity();
  pressure    = bme.readPressure() / 100.0F;

  moistureRaw     = readMoistureRaw();
  moisturePercent = constrain(map(moistureRaw, dryValue, wetValue, 0, 100), 0, 100);

  Serial.print("Lux:");        Serial.print(lux);
  Serial.print(" | Moisture:"); Serial.print(moisturePercent);
  Serial.print("% | Raw:");     Serial.print(moistureRaw);
  Serial.print(" | Temp:");     Serial.print(temperature, 1);
  Serial.print("C | Humidity:"); Serial.print(humidity, 1);
  Serial.print("% | Pressure:"); Serial.println(pressure, 1);
}

// ─────────────────────────────────────────────────────────────
// 서버로 센서값 전송 (서버가 조건 맞으면 펌프 명령을 만들어 둠)
// ─────────────────────────────────────────────────────────────
void postSensorReading() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (WiFi.status() != WL_CONNECTED) return;

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

// ─────────────────────────────────────────────────────────────
// 펌프 가동 (안전 차단 + 웹서버 응답 유지)
// ─────────────────────────────────────────────────────────────
void runPump(int seconds) {
  seconds = constrain(seconds, 1, maxPumpSeconds);

  Serial.print("Pump ON for ");
  Serial.print(seconds);
  Serial.println("s");

  relayWrite(true);
  unsigned long startedAt = millis();
  while (millis() - startedAt < (unsigned long)seconds * 1000UL) {
    server.handleClient(); // 켜져 있는 동안에도 로컬 페이지 응답
    delay(10);
  }
  relayWrite(false); // 무슨 일이 있어도 끈다
  Serial.println("Pump OFF");
}

// ─────────────────────────────────────────────────────────────
// 펌프 명령 확인 → 명령 있으면 실행
// ─────────────────────────────────────────────────────────────
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
  http.end();
}

void pollPumpCommands() {
  if (WiFi.status() != WL_CONNECTED) connectWifi();
  if (WiFi.status() != WL_CONNECTED) return;

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

  String commandId      = jsonStringValue(body, "id");
  int    wateringSeconds = jsonIntValue(body, "watering_seconds");
  if (commandId.length() == 0 || wateringSeconds <= 0) return; // 대기 명령 없음

  patchPumpCommand(commandId, "running");
  runPump(wateringSeconds);
  patchPumpCommand(commandId, "completed");
}

// ─────────────────────────────────────────────────────────────
// setup
// ─────────────────────────────────────────────────────────────
void setup() {
  // 1) 출력으로 잡기 전에 OFF 레벨을 먼저 써서 부팅 순간 릴레이 튐을 최소화.
  digitalWrite(relayPin, relayActiveHigh ? LOW : HIGH); // OFF level
  pinMode(relayPin, OUTPUT);
  relayWrite(false); // 확실히 OFF

  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("=== Plant IoT boot: pump is OFF by default ===");

  Wire.begin(21, 22);
  lightMeter.begin();
  if (!bme.begin(0x76)) {
    Serial.println("BME280 not found at 0x76. Check wiring or try 0x77.");
  }

  pinMode(moisturePin, INPUT);
  if (moisturePowerPin >= 0) {
    pinMode(moisturePowerPin, OUTPUT);
    setMoistureSensorPower(false);
  }

  connectWifi();

  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.begin();
  Serial.println("Web server started");

  readSensors();
  postSensorReading();
  pollPumpCommands();

  unsigned long now = millis();
  lastSensorReadAt = now;
  lastCloudPostAt  = now;
  lastPumpPollAt   = now;
}

// ─────────────────────────────────────────────────────────────
// loop
// ─────────────────────────────────────────────────────────────
void loop() {
  server.handleClient();

  unsigned long now = millis();

  // 테스트 모드: relayToggleSeconds 초마다 릴레이 ON/OFF 반복
  if (relayToggleTest) {
    if (now - lastToggleAt >= (unsigned long)relayToggleSeconds * 1000UL) {
      toggleState = !toggleState;
      relayWrite(toggleState);
      Serial.print("TOGGLE TEST: relay ");
      Serial.println(toggleState ? "ON" : "OFF");
      lastToggleAt = now;
    }
    delay(20);
    return; // 테스트 중엔 자동급수/서버통신 안 함
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
