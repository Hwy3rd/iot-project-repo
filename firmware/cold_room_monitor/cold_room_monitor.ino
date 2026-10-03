/*
 * ESP32 - KHO LANH: GIAM SAT NHIET DO, CUA, NGUON QUAT & COI CANH BAO
 * + MQTT TELEMETRY gui du lieu len server qua broker Mosquitto
 * ---------------------------------------------------------------
 *  GPIO 18 - Cong tac hanh trinh (limit switch phat hien cua)
 *  GPIO  4 - DHT11 cam bien nhiet do / do am
 *  GPIO 19 - Coi bao dong (buzzer)
 *  GPIO 23 - Relay quat lam lanh
 *  GPIO 34 - Cam bien dien ap DC quat
 * ---------------------------------------------------------------
 * Thu vien can cai trong Arduino IDE (Tools > Manage Libraries):
 *   - DHT sensor library    (by Adafruit)
 *   - Adafruit Unified Sensor
 *   - PubSubClient          (by Nick O'Leary)   <- MQTT
 *   - ArduinoJson           (by Benoit Blanchon)
 * ---------------------------------------------------------------
 */

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <time.h>
#include <sys/time.h>

// ======================== CAU HINH WIFI & MQTT ========================
// WiFi, broker, tai khoan thiet bi, DEVICE_ID, NTP nam trong config.h
// (gitignore, khong de mat khau trong code): copy config.example.h -> config.h
// cung thu muc roi sua gia tri.
#if __has_include("config.h")
#include "config.h"
#else
#error "Thieu config.h: copy config.example.h thanh config.h (cung thu muc) roi sua gia tri"
#endif

// Client ID = DEVICE_ID (phai KHOP `unique_id` tren server); topic ghep tu ID
#define MQTT_CLIENT_ID       DEVICE_ID
#define MQTT_TOPIC_TELEMETRY "devices/" DEVICE_ID "/telemetry"

// ======================== CAU HINH PHAN CUNG ========================
#define LIMIT_SWITCH_PIN    18
#define SWITCH_ACTIVE_LOW   true   // LOW = cua dong; HIGH = cua mo

#define DHT_PIN   4
#define DHT_TYPE  DHT11
const float TEMP_ALARM_THRESHOLD = 40.0;   // nguong nhiet do canh bao (do C)

#define PIN_BUZZER         19
#define PIN_FAN_RELAY      23
#define PIN_VOLTAGE_SENSOR 34

const float VOLTAGE_DIVIDER_RATIO = 5.0;   // module chia ap 5:1
const float VOLTAGE_ALARM_DELTA   = 0.5;   // nguong bien dong dien ap (V)
const float MIN_FAN_RUN_VOLTAGE   = 1.0;   // nguong toi thieu xac nhan quat co dien

#define REPORT_INTERVAL_MS 5000   // gui MQTT moi 5 giay

// ======================== KHOI TAO DOI TUONG ========================
DHT dht(DHT_PIN, DHT_TYPE);
WiFiClient   espClient;
PubSubClient mqttClient(espClient);

// ======================== BIEN TRANG THAI ========================
bool  dhtOK            = false;
int   lastSwitchState  = -1;
unsigned long lastDebounce    = 0;
unsigned long lastReport      = 0;
unsigned long lastMqttRetry   = 0;
unsigned long lastBuzzerToggle = 0;
bool  buzzerState      = false;
float stableVoltage    = -1.0;
bool  voltageAnomaly   = false;
bool  lastRelayCommand = false;
bool  alarmActive      = false;   // coi dang bao dong (bat ky su co nao)

// ======================== TIEN ICH ========================
bool isDoorClosed() {
  int v = digitalRead(LIMIT_SWITCH_PIN);
  return SWITCH_ACTIVE_LOW ? (v == LOW) : (v == HIGH);
}

float readDCVoltage() {
  long sum = 0;
  for (int i = 0; i < 50; i++) {
    sum += analogRead(PIN_VOLTAGE_SENSOR);
    delayMicroseconds(200);
  }
  float avgAdc = sum / 50.0;
  return (avgAdc / 4095.0) * 3.3 * VOLTAGE_DIVIDER_RATIO;
}

// ======================== WIFI ========================
void connectWiFi() {
  Serial.printf("Dang ket noi WiFi: %s ", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) {
    delay(500); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED)
    Serial.printf("\nWiFi OK! IP cua ESP32: %s\n", WiFi.localIP().toString().c_str());
  else
    Serial.println("\n[LOI] Khong ket noi duoc WiFi! Kiem tra SSID/Pass.");
}

// ======================== THOI GIAN (NTP) ========================
// SNTP chay ngam, tu dong dong bo lai dinh ky; chi can goi 1 lan.
void setupTime() {
  configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);   // UTC, khong DST
}

// Truoc khi dong bo, dong ho ESP32 dem tu 1970 -> coi la chua co gio thuc.
bool isTimeSynced() {
  return time(nullptr) > 1700000000;   // ~ 11/2023
}

// Ghi gio hien tai dang ISO 8601 UTC co mili-giay, vd "2026-10-03T08:15:30.123Z".
// Server dung (deviceId, ts) lam khoa chong trung, nen moi mau phai co ts rieng.
bool formatIsoTimestamp(char* buf, size_t len) {
  if (!isTimeSynced()) return false;
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  struct tm utc;
  gmtime_r(&tv.tv_sec, &utc);
  size_t n = strftime(buf, len, "%Y-%m-%dT%H:%M:%S", &utc);
  if (n == 0) return false;
  snprintf(buf + n, len - n, ".%03ldZ", (long)(tv.tv_usec / 1000));
  return true;
}

// ======================== MQTT ========================
bool connectMQTT() {
  if (mqttClient.connected()) return true;
  if (WiFi.status() != WL_CONNECTED) { connectWiFi(); return false; }

  Serial.printf("Dang ket noi MQTT Broker %s:%d ...\n", MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  // Broker bat buoc dang nhap (mosquitto.conf: allow_anonymous false).
  // Ma loi 5 = sai username/password.
  if (mqttClient.connect(MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.println("MQTT ket noi thanh cong!");
    return true;
  }
  Serial.printf("[LOI] MQTT that bai, ma: %d. Thu lai sau 5s...\n", mqttClient.state());
  return false;
}

/*
 * Format JSON payload gui len server:
 * {
 *   "ts":          "2024-01-15T10:30:00.000Z",  <- ISO 8601 UTC tu NTP (bat buoc dung gio)
 *   "temperature": 25.5,                         <- null neu cam bien loi
 *   "humidity":    70.0,                         <- do am %; null neu cam bien loi
 *   "doorOpen":    false,                        <- true = cua dang mo
 *   "sensorFault": false,                        <- true = DHT11 bi loi
 *   "fanOn":         true,                       <- relay quat dang bat
 *   "fanVoltage":    11.82,                      <- dien ap nguon quat (V)
 *   "fanPowerFault": false,                      <- quat dang bat ma nguon mat/bien dong
 *   "alarmActive":   false                       <- coi dang bao dong tai cho
 * }
 *
 * Server (NestJS) subscribe topic: devices/+/telemetry
 * Sau do luu vao MongoDB qua TelemetryService.
 */
void publishTelemetry(float temp, float humidity, bool doorOpen, bool sensorFault, float dcVolt) {
  // Server luu dung "ts" thiet bi gui (khong dung gio nhan tin): gio sai thi
  // mau bi loai trung / bi TTL xoa ngay. Chua co gio NTP -> bo qua, khong gui.
  char ts[32];
  if (!formatIsoTimestamp(ts, sizeof(ts))) {
    Serial.println("[NTP] Chua dong bo gio, tam chua gui telemetry...");
    return;
  }

  if (!mqttClient.connected() && !connectMQTT()) return;

  StaticJsonDocument<384> doc;

  doc["ts"] = ts;

  if (sensorFault || isnan(temp))
    doc["temperature"] = nullptr;
  else
    doc["temperature"] = (float)(round(temp * 10.0) / 10.0);

  if (sensorFault || isnan(humidity))
    doc["humidity"] = nullptr;
  else
    doc["humidity"] = (float)(round(humidity * 10.0) / 10.0);

  doc["doorOpen"]    = doorOpen;
  doc["sensorFault"] = sensorFault;

  // Quat tat (cua mo) thi 0 V la binh thuong -> chi bao loi nguon khi quat dang bat
  doc["fanOn"]         = lastRelayCommand;
  doc["fanVoltage"]    = (float)(round(dcVolt * 100.0) / 100.0);
  doc["fanPowerFault"] = lastRelayCommand && voltageAnomaly;
  doc["alarmActive"]   = alarmActive;

  char payload[384];
  serializeJson(doc, payload);

  if (mqttClient.publish(MQTT_TOPIC_TELEMETRY, payload))
    Serial.printf("[MQTT TX] %s\n", payload);
  else
    Serial.println("[MQTT] GUI THAT BAI!");
}

// ======================== KIEM TRA KHOI DONG ========================
void testLimitSwitch() {
  pinMode(LIMIT_SWITCH_PIN, SWITCH_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  delay(10);
  Serial.printf("  Limit switch  GPIO%-2d : [OK] Cua hien tai: %s\n",
    LIMIT_SWITCH_PIN, isDoorClosed() ? "DONG" : "HO");
}

void testDHT() {
  dht.begin(); delay(1500);
  float t = NAN, h = NAN;
  for (int i = 0; i < 3 && (isnan(t) || isnan(h)); i++) {
    t = dht.readTemperature();
    h = dht.readHumidity();
    if (isnan(t) || isnan(h)) delay(1000);
  }
  dhtOK = !isnan(t) && !isnan(h);
  if (dhtOK)
    Serial.printf("  DHT11         GPIO%-2d : [OK] %.1f C, %.1f %%\n", DHT_PIN, t, h);
  else
    Serial.printf("  DHT11         GPIO%-2d : [LOI] Kiem tra lai day cap VCC-GND-D%d!\n", DHT_PIN, DHT_PIN);
}

void testBuzzer() {
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, HIGH); delay(100); digitalWrite(PIN_BUZZER, LOW);
  Serial.printf("  Buzzer        GPIO%-2d : [OK]\n", PIN_BUZZER);
}

// ======================== LOGIC GIAM SAT ========================
void checkSwitchChange() {
  int state = isDoorClosed() ? 1 : 0;
  if (state != lastSwitchState && (millis() - lastDebounce > 50)) {
    lastDebounce    = millis();
    lastSwitchState = state;
    Serial.printf(">>> [EVENT] Cua: %s\n", state ? "DONG (an toan)" : "MO - CANH BAO!");
  }
}

void checkVoltageStability(float v) {
  if (stableVoltage < MIN_FAN_RUN_VOLTAGE && v >= MIN_FAN_RUN_VOLTAGE) {
    stableVoltage = v;
    Serial.printf(">>> [VOLT] Chot dien ap chuan: %.2f V\n", stableVoltage);
  }
  if (stableVoltage >= MIN_FAN_RUN_VOLTAGE) {
    bool drop  = (v < MIN_FAN_RUN_VOLTAGE);
    bool spike = (abs(v - stableVoltage) >= VOLTAGE_ALARM_DELTA);
    voltageAnomaly = drop || spike;
    if (!voltageAnomaly)
      stableVoltage = stableVoltage * 0.98f + v * 0.02f;
  } else {
    voltageAnomaly = (v < MIN_FAN_RUN_VOLTAGE);
  }
}

void handleFanAndAlarmLogic(float temp, bool doorClosed, float dcVolt) {
  bool tempHigh = (!isnan(temp) && temp >= TEMP_ALARM_THRESHOLD);
  bool cmd      = doorClosed;  // Relay bat khi cua dong, tat khi cua mo
  if (cmd != lastRelayCommand) lastRelayCommand = cmd;
  digitalWrite(PIN_FAN_RELAY, cmd ? HIGH : LOW);

  checkVoltageStability(dcVolt);

  // Hu coi khi co bat ky su co nao
  alarmActive = !doorClosed || tempHigh || voltageAnomaly;
  if (alarmActive) {
    if (millis() - lastBuzzerToggle >= 150) {
      lastBuzzerToggle = millis();
      buzzerState = !buzzerState;
      digitalWrite(PIN_BUZZER, buzzerState ? HIGH : LOW);
    }
  } else {
    digitalWrite(PIN_BUZZER, LOW);
    buzzerState = false;
  }
}

void printStatus(float dcVolt) {
  Serial.println("--------------------------------------------");
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t)) Serial.println("Nhiet do/Am   : [LOI DOC]");
  else          Serial.printf("Nhiet do/Am   : %.1f C  |  %.1f %%\n", t, h);

  bool closed = isDoorClosed();
  const char* fanSt = !closed               ? "TAT (cua mo)"
                    : dcVolt >= MIN_FAN_RUN_VOLTAGE ? "CHAY BINH THUONG"
                    :                          "MAT NGUON!";
  Serial.printf("Cua           : %-20s | Quat: %s\n",
    closed ? "DONG" : "[CANH BAO] HO!", fanSt);
  Serial.printf("Dien ap quat  : %.2f V (chuan: %.2f V)  -> %s\n",
    dcVolt,
    stableVoltage > 0 ? stableVoltage : 0.0f,
    voltageAnomaly ? "[CANH BAO] BIEN DONG!" : "On dinh");
}

// ======================== SETUP / LOOP ========================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n============================================");
  Serial.println("  ESP32 KHO LANH  -  MQTT Telemetry v1.1");
  Serial.println("============================================");

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  pinMode(LIMIT_SWITCH_PIN, SWITCH_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  pinMode(PIN_FAN_RELAY, OUTPUT); digitalWrite(PIN_FAN_RELAY, LOW);
  pinMode(PIN_BUZZER,    OUTPUT); digitalWrite(PIN_BUZZER,    LOW);

  Serial.println("\n[KIEM TRA PHAN CUNG]");
  testBuzzer();
  testLimitSwitch();
  testDHT();

  Serial.println("\n[KET NOI MANG & MQTT]");
  connectWiFi();
  setupTime();
  mqttClient.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqttClient.setKeepAlive(30);
  // Mac dinh 256 byte (ca topic + header); payload ~180 byte da sat gioi han
  mqttClient.setBufferSize(512);
  connectMQTT();

  Serial.printf("\nTopic MQTT : %s\n", MQTT_TOPIC_TELEMETRY);
  Serial.println("Bat dau giam sat va gui du lieu...\n");
  lastSwitchState = isDoorClosed() ? 1 : 0;
}

void loop() {
  // Giu ket noi MQTT song; tu dong thu lai neu mat ket noi
  if (!mqttClient.connected() && millis() - lastMqttRetry > 5000) {
    lastMqttRetry = millis();
    connectMQTT();
  }
  mqttClient.loop();

  checkSwitchChange();

  float temp   = dht.readTemperature();
  float hum    = dht.readHumidity();
  bool  closed = isDoorClosed();
  float dcVolt = readDCVoltage();
  bool  fault  = !dhtOK || isnan(temp);

  handleFanAndAlarmLogic(temp, closed, dcVolt);

  if (millis() - lastReport >= REPORT_INTERVAL_MS) {
    lastReport = millis();
    printStatus(dcVolt);
    // Gui telemetry len server qua MQTT
    publishTelemetry(temp, hum, !closed, fault, dcVolt);
  }
}
