/*
 * ESP32 - KHO LANH: GIAM SAT NHIET DO, CUA, NGUON QUAT & COI CANH BAO
 * + MQTT TELEMETRY gui du lieu len server qua broker Mosquitto
 * + NHAN LENH DIEU KHIEN (quat, coi) tu server va gui ack
 * + NHAN NGUONG CANH BAO cua phong lanh tu server (luu NVS)
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
#include <Preferences.h>
#include <esp_system.h>
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
#define MQTT_TOPIC_COMMANDS  "devices/" DEVICE_ID "/commands"
#define MQTT_TOPIC_ACK       "devices/" DEVICE_ID "/ack"
#define MQTT_TOPIC_CONFIG    "devices/" DEVICE_ID "/config"

// ======================== CAU HINH PHAN CUNG ========================
#define LIMIT_SWITCH_PIN    18
#define SWITCH_ACTIVE_LOW   true   // LOW = cua dong; HIGH = cua mo

#define DHT_PIN   4
#define DHT_TYPE  DHT11
// DHT11 thinh thoang doc truot (giao tiep 1 day rat nhay thoi gian, WiFi/ngat
// chen vao) va thu vien tra NaN ~2 s. Dung lai so do hop le gan nhat trong
// khoang nay; chi bao loi cam bien khi khong doc duoc lien tuc lau hon.
const unsigned long DHT_STALE_MS = 10000;

// Nguong du phong khi chua nhan duoc cau hinh phong tu server (thiet bi moi,
// chua gan phong, hoac chua tung ket noi duoc broker). Co cau hinh roi thi
// dung nguong cua phong (topic devices/<DEVICE_ID>/config, luu trong NVS).
const float DEFAULT_TEMP_MAX          = 40.0;   // do C
const float DEFAULT_HYSTERESIS        = 1.0;    // do C
const unsigned long DEFAULT_DOOR_OPEN_MAX_S = 15;   // giay

#define PIN_BUZZER         19
#define PIN_FAN_RELAY      23
#define PIN_VOLTAGE_SENSOR 34

const float VOLTAGE_DIVIDER_RATIO = 5.0;   // module chia ap 5:1
// Quat chay hay khong duoc xac dinh bang dien ap DO DUOC, khong theo lenh relay.
const float MIN_FAN_RUN_VOLTAGE   = 1.0;   // tu muc nay tro len = quat co dien (dang chay)
const float FAN_LOW_VOLTAGE_RATIO = 0.8;   // duoi 80% muc chuan = dien ap thap
const float VOLTAGE_ALARM_DELTA   = 0.5;   // cao hon muc chuan chung nay = dien ap vot (V)
// Loi nguon phai keo dai chung nay moi tinh (va het loi cung vay), tranh bao
// nham vi nhieu ADC.
const unsigned long FAN_FAULT_CONFIRM_MS = 2000;
// Tat relay xong dien ap con roi dan; qua khoang nay ma van co dien thi relay
// co the bi dinh.
const unsigned long FAN_SPINDOWN_GRACE_MS = 10000;
// Quat vua bat thi dien ap len dan (~15-20 s tren mach that): chua xet loi
// nguon trong khoang nay, neu khong moi lan dong cua coi se keu nham.
const unsigned long FAN_SPINUP_GRACE_MS = 25000;
// Muc chuan = muc on dinh (dao dong khong qua FAN_STABLE_TOLERANCE trong
// FAN_STABLE_MS) CAO NHAT gap duoc trong FAN_LEARN_MS sau khi khoi dong: quat
// len dien ap cham co the dung o muc trung gian mot luc. Trong luc hoc chi xet
// mat nguon / dien ap thap; het hoc moi xet ca dien ap vot.
const float         FAN_STABLE_TOLERANCE = 0.1;   // V
const unsigned long FAN_STABLE_MS        = 3000;
const unsigned long FAN_LEARN_MS         = 60000;
// Sau khi khoi dong xong (WiFi/MQTT da ket noi) moi bat quat: dong khoi dong
// cua motor cong voi dong WiFi luc ket noi de lam sut ap -> ESP32 reset
// (brownout) lien tuc.
const unsigned long FAN_START_DELAY_MS = 3000;

// Cong tac cua phai giu nguyen trang thai chung nay moi tinh la doi (chong
// rung tiep diem: khong bao cua dong/mo lien tuc, khong dat lai dong ho cua mo).
const unsigned long DOOR_DEBOUNCE_MS = 200;

#define REPORT_INTERVAL_MS 5000   // gui MQTT dinh ky moi 5 giay
// Cua / quat / coi doi trang thai thi gui ngay (khong cho chu ky 5 giay), de
// giao dien cap nhat tuc thi; giu cach nhau toi thieu de cong tac rung (bounce)
// khong lam ngap broker.
#define EVENT_MIN_GAP_MS   300

// Lenh tu server ghi de logic tu dong (quat luon chay, coi theo su co) trong
// khoang nay, sau do thiet bi tu quay lai che do tu dong.
const unsigned long MANUAL_OVERRIDE_MS = 10UL * 60UL * 1000UL;   // 10 phut

// So lenh gan nhat nho lai de chong chay trung (server gui lai lenh chua co
// ack; MQTT QoS 1 cung co the giao 1 lenh 2 lan).
#define RECENT_COMMANDS 8

// ======================== KHOI TAO DOI TUONG ========================
DHT dht(DHT_PIN, DHT_TYPE);
WiFiClient   espClient;
PubSubClient mqttClient(espClient);
Preferences  prefs;

// ======================== BIEN TRANG THAI ========================
bool  dhtOK            = false;
float lastGoodTemp     = NAN;     // so do DHT hop le gan nhat
float lastGoodHum      = NAN;
unsigned long lastGoodTempAt = 0;
unsigned long lastGoodHumAt  = 0;
unsigned long lastReport      = 0;
unsigned long lastMqttRetry   = 0;
unsigned long lastBuzzerToggle = 0;
bool  buzzerState      = false;
float fanNominalVoltage = -1.0;   // dien ap chuan, chot khi quat chay on dinh
float fanStableCandidate = -1.0;  // muc dang cho xac nhan on dinh
unsigned long fanStableSince = 0;
bool  fanRunning       = false;   // quat dang co dien (theo dien ap do)
unsigned long fanOffSince = 0;    // millis() luc relay quat tat
// Loi nguon quat dang co: "no_power" | "low_voltage" | "high_voltage" |
// "stuck_on"; nullptr = binh thuong.
const char* fanFault        = nullptr;
const char* fanFaultPending = nullptr;   // loi dang cho xac nhan
unsigned long fanFaultPendingSince = 0;
bool  lastRelayCommand = false;
unsigned long fanAllowedAt = 0;   // millis() tu luc nay quat moi duoc tu dong bat (0 = chua)
unsigned long fanOnSince = 0;     // millis() luc relay quat bat
bool  fanPowerFault    = false;   // = (fanFault != nullptr)
bool  doorClosed       = true;    // trang thai cua da chong rung
bool  doorRawLast      = true;
unsigned long doorRawChangedAt = 0;
bool  alarmActive      = false;   // coi dang bao dong (bat ky su co nao)
int   lastSentState    = -1;      // trang thai cua/quat/coi trong lan gui gan nhat
bool  tempAlarm        = false;   // nhiet do ngoai nguong (co tre hysteresis)
unsigned long doorOpenSince = 0;  // millis() luc cua bat dau mo
bool  doorOpenTiming   = false;   // dang dem thoi gian cua mo

// Nguong canh bao cua phong, server gui xuong (xem onConfigMessage)
struct RoomConfig {
  bool  hasConfig;           // false = dang dung nguong du phong
  float tempMin;
  float tempMax;
  float hysteresis;
  unsigned long doorOpenMaxS;
  char  version[40];         // server dat; gui lai trong telemetry de doi chieu
};
RoomConfig roomConfig;

// Trang thai ghi de bang lenh tu server cho 1 actuator
struct Override {
  bool active;
  bool on;
  unsigned long until;   // millis() het han
};
Override fanOverride    = { false, false, 0 };
Override buzzerOverride = { false, false, 0 };

// Lenh da xu ly: id + ket qua (error = nullptr nghia la "done")
struct RecentCommand {
  char id[40];
  const char* error;
};
RecentCommand recentCommands[RECENT_COMMANDS];
int recentCommandNext = 0;

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
    // Clean session: subscription mat sau moi lan ket noi lai -> dang ky lai
    if (mqttClient.subscribe(MQTT_TOPIC_COMMANDS, 1))
      Serial.printf("Da subscribe %s\n", MQTT_TOPIC_COMMANDS);
    else
      Serial.println("[LOI] Subscribe topic lenh that bai!");
    // Cau hinh la tin retained: broker gui lai ban moi nhat ngay khi subscribe
    if (mqttClient.subscribe(MQTT_TOPIC_CONFIG, 1))
      Serial.printf("Da subscribe %s\n", MQTT_TOPIC_CONFIG);
    else
      Serial.println("[LOI] Subscribe topic cau hinh that bai!");
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
 *   "fanOn":         true,                       <- quat dang co dien (theo dien ap do)
 *   "fanRelayOn":    true,                       <- relay quat dang duoc bat
 *   "fanVoltage":    11.82,                      <- dien ap nguon quat (V)
 *   "fanPowerFault": false,                      <- co loi nguon quat (xem fanFault)
 *   "fanFault":      null,                       <- no_power | low_voltage | high_voltage | stuck_on
 *   "alarmActive":   false,                      <- coi dang bao dong tai cho
 *   "fanManualSec":    0,                        <- giay con lai cua lenh ghi de quat; 0 = tu dong
 *   "buzzerManualSec": 0,                        <- nhu tren, cho coi
 *   "configVersion":   "2026-10-07T08:00:00.000Z" <- ban cau hinh phong dang dung; null = nguong du phong
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

  StaticJsonDocument<640> doc;

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

  // fanOn = quat THAT SU co dien (theo dien ap do); fanRelayOn = lenh dang
  // gui toi relay. Hai gia tri lech nhau = quat dang khoi dong/dung hoac loi.
  doc["fanOn"]         = fanRunning;
  doc["fanRelayOn"]    = lastRelayCommand;
  doc["fanVoltage"]    = (float)(round(dcVolt * 100.0) / 100.0);
  doc["fanPowerFault"] = fanPowerFault;
  if (fanFault) doc["fanFault"] = fanFault;
  else          doc["fanFault"] = nullptr;
  doc["alarmActive"]   = alarmActive;

  doc["fanManualSec"]    = overrideRemainingSec(fanOverride);
  doc["buzzerManualSec"] = overrideRemainingSec(buzzerOverride);
  if (roomConfig.hasConfig) doc["configVersion"] = roomConfig.version;
  else                      doc["configVersion"] = nullptr;

  char payload[640];
  serializeJson(doc, payload);

  if (mqttClient.publish(MQTT_TOPIC_TELEMETRY, payload))
    Serial.printf("[MQTT TX] %s\n", payload);
  else
    Serial.println("[MQTT] GUI THAT BAI!");
}

// ======================== LENH DIEU KHIEN ========================
/*
 * Lenh server gui xuong topic devices/<DEVICE_ID>/commands:
 * {
 *   "id":        "0199a1b2-...",               <- ma lenh, dung de ack/chong trung
 *   "channel":   "fan_motor",                  <- fan_motor | buzzer
 *   "label":     null,
 *   "action":    "on",                         <- on | off | auto (bo ghi de, ve tu dong)
 *   "expiresAt": "2026-10-03T08:01:00.000Z"    <- qua gio nay thi tu choi
 * }
 * Ack gui len devices/<DEVICE_ID>/ack:
 *   {"id": "...", "status": "done"}
 *   {"id": "...", "status": "failed", "error": "unsupported_channel"}
 */

bool overrideActive(Override& o) {
  if (o.active && (long)(millis() - o.until) >= 0) {
    o.active = false;
    Serial.println(">>> [LENH] Het thoi gian ghi de, quay lai che do tu dong");
  }
  return o.active;
}

// So giay con lai cua lenh ghi de; 0 = dang o che do tu dong
unsigned long overrideRemainingSec(Override& o) {
  if (!overrideActive(o)) return 0;
  return (o.until - millis() + 999UL) / 1000UL;
}

int findRecentCommand(const char* id) {
  for (int i = 0; i < RECENT_COMMANDS; i++)
    if (strcmp(recentCommands[i].id, id) == 0) return i;
  return -1;
}

void rememberCommand(const char* id, const char* error) {
  RecentCommand& slot = recentCommands[recentCommandNext];
  strlcpy(slot.id, id, sizeof(slot.id));
  slot.error = error;
  recentCommandNext = (recentCommandNext + 1) % RECENT_COMMANDS;
}

// "2026-10-03T08:01:00.000Z" -> da qua chua. Chua co gio NTP thi khong kiem
// tra duoc -> coi nhu con han (server van tu het han lenh phia minh).
bool isExpired(const char* iso) {
  if (!iso || !isTimeSynced()) return false;
  struct tm t = {};
  if (sscanf(iso, "%4d-%2d-%2dT%2d:%2d:%2d", &t.tm_year, &t.tm_mon, &t.tm_mday,
             &t.tm_hour, &t.tm_min, &t.tm_sec) != 6) return false;
  t.tm_year -= 1900;
  t.tm_mon  -= 1;
  return time(nullptr) >= mktime(&t);   // configTime(0, 0) -> mktime la UTC
}

// Tra ve nullptr neu thuc hien duoc, nguoc lai la ly do loi (gui trong ack).
const char* executeCommand(const char* channel, const char* action, const char* expiresAt) {
  bool on   = false;
  bool toAuto = false;
  if      (strcmp(action, "on")   == 0) on = true;
  else if (strcmp(action, "off")  == 0) on = false;
  else if (strcmp(action, "auto") == 0) toAuto = true;
  else return "unsupported_action";

  Override* target;
  if      (strcmp(channel, "fan_motor") == 0) target = &fanOverride;
  else if (strcmp(channel, "buzzer")    == 0) target = &buzzerOverride;
  else return "unsupported_channel";

  if (isExpired(expiresAt)) return "expired";

  if (toAuto) {
    target->active = false;
    Serial.printf(">>> [LENH] %s -> TU DONG\n", channel);
    return nullptr;
  }
  target->active = true;
  target->on     = on;
  target->until  = millis() + MANUAL_OVERRIDE_MS;
  Serial.printf(">>> [LENH] %s -> %s (ghi de %lu phut)\n",
    channel, on ? "BAT" : "TAT", MANUAL_OVERRIDE_MS / 60000UL);
  return nullptr;
}

void publishAck(const char* id, const char* error) {
  StaticJsonDocument<160> doc;
  doc["id"]     = id;
  doc["status"] = error ? "failed" : "done";
  if (error) doc["error"] = error;
  char payload[160];
  serializeJson(doc, payload);
  if (mqttClient.publish(MQTT_TOPIC_ACK, payload))
    Serial.printf("[MQTT ACK] %s\n", payload);
  else
    Serial.println("[MQTT] GUI ACK THAT BAI! (server se gui lai lenh)");
}

// ======================== CAU HINH PHONG ========================
/*
 * Server gui nguong cua phong ma thiet bi dang gan vao, dang tin RETAINED tren
 * devices/<DEVICE_ID>/config (moi lan sua phong / gan / go thiet bi):
 * {
 *   "version":            "2026-10-07T08:00:00.000Z",
 *   "tempMin":            28,
 *   "tempMax":            30,
 *   "hysteresis":         0.5,
 *   "doorOpenMaxSeconds": 30
 * }
 * Payload rong = thiet bi khong con gan phong nao -> quay ve nguong du phong.
 * Luu vao NVS de mat mang / khoi dong lai van canh bao dung nguong.
 */
void useDefaultConfig() {
  roomConfig.hasConfig    = false;
  roomConfig.tempMin      = -INFINITY;
  roomConfig.tempMax      = DEFAULT_TEMP_MAX;
  roomConfig.hysteresis   = DEFAULT_HYSTERESIS;
  roomConfig.doorOpenMaxS = DEFAULT_DOOR_OPEN_MAX_S;
  roomConfig.version[0]   = '\0';
}

void printConfig() {
  if (roomConfig.hasConfig)
    Serial.printf(">>> [CAU HINH] Nguong phong: %.1f..%.1f C, tre %.1f C, cua mo toi da %lus (ban %s)\n",
      roomConfig.tempMin, roomConfig.tempMax, roomConfig.hysteresis,
      roomConfig.doorOpenMaxS, roomConfig.version);
  else
    Serial.printf(">>> [CAU HINH] Chua co nguong phong -> du phong: >= %.1f C, cua mo toi da %lus\n",
      roomConfig.tempMax, roomConfig.doorOpenMaxS);
}

void loadConfig() {
  useDefaultConfig();
  prefs.begin("roomcfg", true);
  if (prefs.getBool("has", false)) {
    roomConfig.hasConfig    = true;
    roomConfig.tempMin      = prefs.getFloat("tmin", roomConfig.tempMin);
    roomConfig.tempMax      = prefs.getFloat("tmax", roomConfig.tempMax);
    roomConfig.hysteresis   = prefs.getFloat("hyst", roomConfig.hysteresis);
    roomConfig.doorOpenMaxS = prefs.getULong("door", roomConfig.doorOpenMaxS);
    prefs.getString("ver", roomConfig.version, sizeof(roomConfig.version));
  }
  prefs.end();
}

void saveConfig() {
  prefs.begin("roomcfg", false);
  if (roomConfig.hasConfig) {
    prefs.putBool("has", true);
    prefs.putFloat("tmin", roomConfig.tempMin);
    prefs.putFloat("tmax", roomConfig.tempMax);
    prefs.putFloat("hyst", roomConfig.hysteresis);
    prefs.putULong("door", roomConfig.doorOpenMaxS);
    prefs.putString("ver", roomConfig.version);
  } else {
    prefs.clear();
  }
  prefs.end();
}

void onConfigMessage(byte* payload, unsigned int length) {
  if (length == 0) {
    if (!roomConfig.hasConfig) return;
    useDefaultConfig();
    saveConfig();
    tempAlarm = false;
    printConfig();
    return;
  }

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, (const byte*)payload, length)) {
    Serial.println("[CAU HINH] Bo qua: JSON khong hop le");
    return;
  }
  const char* version = doc["version"] | "";
  float tmin = doc["tempMin"]    | NAN;
  float tmax = doc["tempMax"]    | NAN;
  float hyst = doc["hysteresis"] | NAN;
  long  door = doc["doorOpenMaxSeconds"] | -1L;
  if (!*version || strlen(version) >= sizeof(roomConfig.version) ||
      isnan(tmin) || isnan(tmax) || tmin >= tmax ||
      isnan(hyst) || hyst < 0 || door < 0) {
    Serial.println("[CAU HINH] Bo qua: thieu/sai truong");
    return;
  }
  // Broker gui lai tin retained moi lan ket noi lai -> khong ghi NVS neu khong doi
  if (roomConfig.hasConfig && strcmp(roomConfig.version, version) == 0) return;

  roomConfig.hasConfig    = true;
  roomConfig.tempMin      = tmin;
  roomConfig.tempMax      = tmax;
  roomConfig.hysteresis   = hyst;
  roomConfig.doorOpenMaxS = (unsigned long)door;
  strlcpy(roomConfig.version, version, sizeof(roomConfig.version));
  saveConfig();
  tempAlarm = false;   // danh gia lai tu dau voi nguong moi
  printConfig();
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, MQTT_TOPIC_CONFIG) == 0) {
    onConfigMessage(payload, length);
    return;
  }
  if (strcmp(topic, MQTT_TOPIC_COMMANDS) != 0) return;

  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, (const byte*)payload, length)) {
    Serial.println("[LENH] Bo qua: JSON khong hop le");
    return;
  }
  const char* id = doc["id"];
  if (!id || !*id || strlen(id) >= sizeof(RecentCommand::id)) {
    Serial.println("[LENH] Bo qua: thieu id");   // khong co id thi khong ack duoc
    return;
  }
  // Chep id ra truoc khi publish: bo dem cua PubSubClient dung chung cho
  // tin nhan den va di.
  char cmdId[sizeof(RecentCommand::id)];
  strlcpy(cmdId, id, sizeof(cmdId));

  // Lenh da chay roi (server gui lai vi chua nhan ack) -> chi ack lai
  int seen = findRecentCommand(cmdId);
  if (seen >= 0) {
    publishAck(cmdId, recentCommands[seen].error);
    return;
  }

  const char* channel = doc["channel"] | "";
  const char* action  = doc["action"]  | "";
  const char* error   = executeCommand(channel, action, doc["expiresAt"]);
  rememberCommand(cmdId, error);
  publishAck(cmdId, error);
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
// So do moi neu doc duoc; doc truot thi dung so do hop le gan nhat, mien la
// chua qua DHT_STALE_MS. Qua lau khong doc duoc -> NaN (loi cam bien).
float readStable(float v, float& lastGood, unsigned long& lastGoodAt) {
  unsigned long now = millis();
  if (!isnan(v)) {
    lastGood   = v;
    lastGoodAt = now;
    return v;
  }
  if (!isnan(lastGood) && now - lastGoodAt <= DHT_STALE_MS) return lastGood;
  return NAN;
}

// Cap nhat trang thai cua da chong rung; in su kien khi cua thuc su doi.
void updateDoor() {
  bool raw = isDoorClosed();
  if (raw != doorRawLast) {
    doorRawLast      = raw;
    doorRawChangedAt = millis();
  }
  if (raw != doorClosed && millis() - doorRawChangedAt >= DOOR_DEBOUNCE_MS) {
    doorClosed = raw;
    Serial.printf(">>> [EVENT] Cua: %s\n", doorClosed ? "DONG (an toan)" : "MO - CANH BAO!");
  }
}

// Danh gia nguon quat tu dien ap do duoc. Chua xet trong luc quat khoi dong
// (dien ap dang len) va ngay sau khi tat (dien ap dang roi); het khoang do
// moi chot muc chuan va so sanh. Loi chi duoc ghi nhan (hoac xoa) khi keo dai
// FAN_FAULT_CONFIRM_MS.
void evaluateFanPower(bool relayOn, float v) {
  unsigned long now = millis();
  fanRunning = v >= MIN_FAN_RUN_VOLTAGE;

  const char* candidate = nullptr;
  if (relayOn) {
    if (now - fanOnSince < FAN_SPINUP_GRACE_MS) {
      fanNominalVoltage  = -1.0;   // chot lai sau khi khoi dong xong
      fanStableCandidate = -1.0;
    } else {
      bool learning = now - fanOnSince < FAN_SPINUP_GRACE_MS + FAN_LEARN_MS;
      // Dang hoc: muc on dinh cao hon muc chuan hien tai thi nang muc chuan len
      if (learning && fanRunning) {
        if (fanStableCandidate < 0 || fabs(v - fanStableCandidate) > FAN_STABLE_TOLERANCE) {
          fanStableCandidate = v;
          fanStableSince     = now;
        } else if (now - fanStableSince >= FAN_STABLE_MS &&
                   fanStableCandidate > fanNominalVoltage + FAN_STABLE_TOLERANCE) {
          fanNominalVoltage = fanStableCandidate;
          Serial.printf(">>> [VOLT] Quat chay on dinh, dien ap chuan: %.2f V\n", fanNominalVoltage);
        }
      }
      bool hasNominal = fanNominalVoltage >= MIN_FAN_RUN_VOLTAGE;
      if (!fanRunning)                                                       candidate = "no_power";
      else if (hasNominal && v < fanNominalVoltage * FAN_LOW_VOLTAGE_RATIO) candidate = "low_voltage";
      else if (hasNominal && !learning && v > fanNominalVoltage + VOLTAGE_ALARM_DELTA)
                                                                             candidate = "high_voltage";
    }
  } else if (now - fanOffSince >= FAN_SPINDOWN_GRACE_MS && fanRunning) {
    candidate = "stuck_on";
  }

  if (candidate != fanFaultPending) {
    fanFaultPending      = candidate;
    fanFaultPendingSince = now;
  }
  if (fanFault != fanFaultPending && now - fanFaultPendingSince >= FAN_FAULT_CONFIRM_MS) {
    fanFault = fanFaultPending;
    if (fanFault) Serial.printf(">>> [VOLT] LOI NGUON QUAT: %s (%.2f V)\n", fanFault, v);
    else          Serial.println(">>> [VOLT] Nguon quat binh thuong tro lai");
  }
  // Chuyen sang trang thai khong can xet (vua bat / vua tat): xoa loi ngay
  if (!candidate && !relayOn && now - fanOffSince < FAN_SPINDOWN_GRACE_MS) fanFault = nullptr;
  if (!candidate && relayOn && now - fanOnSince < FAN_SPINUP_GRACE_MS)     fanFault = nullptr;
  fanPowerFault = fanFault != nullptr;
}

// Ngoai nguong phong thi bao; chi het bao khi da vao trong nguong them 1
// khoang hysteresis, de coi khong bat/tat lien tuc khi nhiet do dao quanh
// nguong. Cam bien loi thi giu nguyen trang thai cu.
void updateTempAlarm(float temp) {
  if (isnan(temp)) return;
  const RoomConfig& c = roomConfig;
  if (!tempAlarm) {
    tempAlarm = c.hasConfig ? (temp > c.tempMax || temp < c.tempMin)
                            : (temp >= c.tempMax);
  } else {
    // Dai qua hep cho hysteresis (max - min <= 2*hyst): chi can vao lai trong dai
    float h = min(c.hysteresis, (c.tempMax - c.tempMin) / 2.0f);
    tempAlarm = !(temp <= c.tempMax - h && temp >= c.tempMin + h);
  }
}

// Cua mo qua thoi gian cho phep cua phong (doorOpenMaxSeconds)
bool doorOpenTooLong(bool doorClosed) {
  if (doorClosed) { doorOpenTiming = false; return false; }
  if (!doorOpenTiming) { doorOpenTiming = true; doorOpenSince = millis(); }
  return millis() - doorOpenSince >= roomConfig.doorOpenMaxS * 1000UL;
}

void handleFanAndAlarmLogic(float temp, bool doorClosed, float dcVolt) {
  updateTempAlarm(temp);
  bool doorAlarm = doorOpenTooLong(doorClosed);
  // Tu dong: quat lam lanh luon chay, khong phu thuoc cua. Chi lenh tu
  // server (bat/tat tren giao dien) moi doi trang thai quat.
  static bool relayInit = false;
  bool fanReady = fanAllowedAt != 0 && millis() >= fanAllowedAt;
  bool fanOn = overrideActive(fanOverride) ? fanOverride.on : fanReady;
  if (!relayInit || fanOn != lastRelayCommand) {
    if (fanOn) fanOnSince = millis();   // vua bat (ke ca luc khoi dong)
    else       fanOffSince = millis();
    relayInit = true;
  }
  lastRelayCommand = fanOn;
  digitalWrite(PIN_FAN_RELAY, fanOn ? HIGH : LOW);

  evaluateFanPower(fanOn, dcVolt);

  // Hu coi khi co bat ky su co nao: nhiet do ngoai nguong phong, cua mo qua
  // lau, nguon quat bat thuong (mat nguon, dien ap thap/vot, relay dinh).
  // Lenh tu server ghi de (vd tat coi trong luc dang xu ly su co).
  bool incident = doorAlarm || tempAlarm || fanPowerFault;
  alarmActive = overrideActive(buzzerOverride) ? buzzerOverride.on : incident;
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

// In dung so do vua gui len MQTT (khong doc DHT lan nua), de serial va
// server luon khop nhau.
void printStatus(float t, float h, float dcVolt) {
  Serial.println("--------------------------------------------");
  if (isnan(t)) {
    Serial.println("Nhiet do/Am   : [LOI DOC]");
  } else if (!tempAlarm) {
    Serial.printf("Nhiet do/Am   : %.1f C  |  %.1f %%\n", t, h);
  } else if (t > roomConfig.tempMax || t < roomConfig.tempMin ||
             (!roomConfig.hasConfig && t >= roomConfig.tempMax)) {
    Serial.printf("Nhiet do/Am   : %.1f C  |  %.1f %%  -> [CANH BAO] NGOAI NGUONG!\n", t, h);
  } else {
    // Da vao lai trong nguong nhung chua qua khoang tre (hysteresis)
    float hy = min(roomConfig.hysteresis, (roomConfig.tempMax - roomConfig.tempMin) / 2.0f);
    if (roomConfig.hasConfig)
      Serial.printf("Nhiet do/Am   : %.1f C  |  %.1f %%  -> [CANH BAO] CHO VE %.1f..%.1f C (tre %.1f C)\n",
        t, h, roomConfig.tempMin + hy, roomConfig.tempMax - hy, hy);
    else
      Serial.printf("Nhiet do/Am   : %.1f C  |  %.1f %%  -> [CANH BAO] CHO XUONG <= %.1f C (tre %.1f C)\n",
        t, h, roomConfig.tempMax - hy, hy);
  }

  bool closed = doorClosed;
  const char* fanSt = fanFault ? "[CANH BAO] LOI NGUON"
                    : lastRelayCommand ? (fanRunning ? "DANG CHAY" : "DANG KHOI DONG")
                    : (fanRunning ? "DANG DUNG" : "TAT");
  const char* doorSt = closed ? "DONG"
                     : doorOpenTooLong(closed) ? "[CANH BAO] MO QUA LAU!"
                     : "MO";
  Serial.printf("Cua           : %-22s | Quat: %s%s\n", doorSt, fanSt,
    fanOverride.active ? " [LENH]" : "");
  const char* voltSt =
      !fanFault                                ? (fanRunning ? "On dinh" : "Khong co dien")
    : strcmp(fanFault, "no_power") == 0     ? "[CANH BAO] MAT NGUON!"
    : strcmp(fanFault, "low_voltage") == 0  ? "[CANH BAO] DIEN AP THAP!"
    : strcmp(fanFault, "high_voltage") == 0 ? "[CANH BAO] DIEN AP VOT!"
    :                                         "[CANH BAO] DA TAT MA VAN CO DIEN (relay dinh?)";
  Serial.printf("Dien ap quat  : %.2f V (chuan: %.2f V)  -> %s\n",
    dcVolt, fanNominalVoltage > 0 ? fanNominalVoltage : 0.0f, voltSt);
  Serial.printf("Coi           : %s%s\n", alarmActive ? "DANG KEU" : "IM",
    buzzerOverride.active ? " [LENH]" : "");
}

// Ly do lan khoi dong nay. BROWNOUT = nguon tut ap (thuong do quat/relay
// keo dong luc khoi dong), PANIC/WDT = loi phan mem.
const char* resetReasonText() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:   return "POWERON (cap nguon)";
    case ESP_RST_EXT:       return "EXT (chan reset ngoai)";
    case ESP_RST_SW:        return "SW (phan mem goi restart)";
    case ESP_RST_PANIC:     return "PANIC (loi phan mem / crash)";
    case ESP_RST_INT_WDT:   return "INT_WDT (watchdog ngat)";
    case ESP_RST_TASK_WDT:  return "TASK_WDT (watchdog task)";
    case ESP_RST_WDT:       return "WDT (watchdog)";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT:  return "BROWNOUT (sut ap nguon!)";
    case ESP_RST_SDIO:      return "SDIO";
    default:                return "KHONG RO";
  }
}

// ======================== SETUP / LOOP ========================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n============================================");
  Serial.println("  ESP32 KHO LANH  -  MQTT Telemetry v1.3");
  Serial.println("============================================");
  Serial.printf("Ly do khoi dong: %s\n", resetReasonText());
  if (esp_reset_reason() == ESP_RST_BROWNOUT)
    Serial.println("[CANH BAO] Lan truoc bi SUT AP: kiem tra nguon cap cho quat/relay (xem README)");

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  pinMode(LIMIT_SWITCH_PIN, SWITCH_ACTIVE_LOW ? INPUT_PULLUP : INPUT_PULLDOWN);
  pinMode(PIN_FAN_RELAY, OUTPUT); digitalWrite(PIN_FAN_RELAY, LOW);
  pinMode(PIN_BUZZER,    OUTPUT); digitalWrite(PIN_BUZZER,    LOW);

  Serial.println("\n[KIEM TRA PHAN CUNG]");
  testBuzzer();
  testLimitSwitch();
  testDHT();

  // Nguong phong da nhan lan truoc (NVS); server gui ban moi khi ket noi MQTT
  loadConfig();
  printConfig();

  Serial.println("\n[KET NOI MANG & MQTT]");
  connectWiFi();
  setupTime();
  mqttClient.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqttClient.setKeepAlive(30);
  // Mac dinh 256 byte (ca topic + header); telemetry ~340 byte vuot gioi han
  mqttClient.setBufferSize(768);
  mqttClient.setCallback(onMqttMessage);
  connectMQTT();

  Serial.printf("\nTopic MQTT : %s\n", MQTT_TOPIC_TELEMETRY);
  Serial.printf("Topic lenh : %s\n", MQTT_TOPIC_COMMANDS);
  Serial.printf("Topic nguong: %s\n", MQTT_TOPIC_CONFIG);
  Serial.println("Bat dau giam sat va gui du lieu...\n");
  doorClosed = doorRawLast = isDoorClosed();
  fanAllowedAt = millis() + FAN_START_DELAY_MS;
  Serial.printf("Quat se bat sau %lu giay (tranh sut ap luc khoi dong)\n", FAN_START_DELAY_MS / 1000UL);
}

void loop() {
  // Giu ket noi MQTT song; tu dong thu lai neu mat ket noi
  if (!mqttClient.connected() && millis() - lastMqttRetry > 5000) {
    lastMqttRetry = millis();
    connectMQTT();
  }
  mqttClient.loop();

  updateDoor();

  float temp   = readStable(dht.readTemperature(), lastGoodTemp, lastGoodTempAt);
  float hum    = readStable(dht.readHumidity(),    lastGoodHum,  lastGoodHumAt);
  bool  closed = doorClosed;
  float dcVolt = readDCVoltage();
  // Loi cam bien = khong co so do hop le nao trong DHT_STALE_MS (mot lan doc
  // truot le te khong tinh); cam bien loi luc khoi dong roi doc lai duoc thi
  // so do van duoc gui binh thuong.
  bool  fault  = isnan(temp);

  handleFanAndAlarmLogic(temp, closed, dcVolt);

  // Gui ngay khi cua / quat / coi doi trang thai, ngoai chu ky dinh ky
  int state = (closed ? 1 : 0) | (lastRelayCommand ? 2 : 0) | (alarmActive ? 4 : 0) |
              (fanPowerFault ? 8 : 0) | (fanRunning ? 16 : 0);
  bool changed = (state != lastSentState) && (millis() - lastReport >= EVENT_MIN_GAP_MS);

  if (changed || millis() - lastReport >= REPORT_INTERVAL_MS) {
    lastReport    = millis();
    lastSentState = state;
    printStatus(temp, hum, dcVolt);
    // Gui telemetry len server qua MQTT
    publishTelemetry(temp, hum, !closed, fault, dcVolt);
  }
}
