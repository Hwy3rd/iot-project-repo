#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <LittleFS.h>

// Dedicated LittleFS directory. No automatic formatting: a failed mount must
// never erase a filesystem. Each sample is committed by temp-file + rename.
// Bound disk usage; overflow drops the oldest record with an explicit warning.
class OfflineTelemetryQueue {
 public:
  static const size_t CAPACITY = 720;

  bool begin() {
    ready = LittleFS.begin(false);
    if (!ready) {
      Serial.println("[OFFLINE] LittleFS unavailable; telemetry is NOT durable. Prepare a filesystem partition.");
      return false;
    }
    if (!LittleFS.exists("/telemetry")) LittleFS.mkdir("/telemetry");
    File directory = LittleFS.open("/telemetry");
    for (File file = directory.openNextFile(); file; file = directory.openNextFile()) {
      String name = file.name();
      int slash = name.lastIndexOf('/');
      if (slash >= 0) name = name.substring(slash + 1);
      if (name.length() == 22 && name.endsWith(".json")) {
        String key = name.substring(0, 17);
        if (validKey(key.c_str())) remember(key.c_str());
      }
      file.close();
    }
    directory.close();
    Serial.printf("[OFFLINE] Recovered %u pending samples\n", (unsigned)count);
    return true;
  }

  bool append(const char* ts, const char* payload) {
    if (!ready) return false;
    char key[18];
    if (!timestampKey(ts, key)) return false;
    String target = path(key);
    if (LittleFS.exists(target)) return true;
    File file = LittleFS.open("/telemetry/pending.tmp", "w");
    if (!file) return false;
    size_t written = file.print(payload);
    file.flush();
    file.close();
    if (written != strlen(payload) || !LittleFS.rename("/telemetry/pending.tmp", target)) {
      Serial.println("[OFFLINE] Disk write failed; pending sample was not committed");
      return false;
    }
    remember(key);
    return true;
  }

  // Called only after the backend confirms MongoDB + incident/outbox handling.
  void acknowledge(const char* ts, const char* status) {
    if (!ready || (strcmp(status, "stored") && strcmp(status, "discarded"))) return;
    char key[18];
    if (!timestampKey(ts, key)) return;
    for (size_t i = 0; i < count; i++) {
      if (!strcmp(keys[i], key)) {
        if (!strcmp(status, "discarded")) Serial.printf("[OFFLINE] Server discarded %s (timestamp/room/lifecycle)\n", ts);
        if (LittleFS.remove(path(key))) eraseIndex(i);
        return;
      }
    }
  }

  // Round-robin prevents one rejected/unacknowledged sample blocking the rest.
  // Live samples are also sent immediately by publishTelemetry().
  void flushOne(PubSubClient& client, const char* topic) {
    if (!ready || !count || !client.connected() || millis() - lastSend < 250) return;
    lastSend = millis();
    if (cursor >= count) cursor = 0;
    size_t index = cursor++;
    File file = LittleFS.open(path(keys[index]), "r");
    if (!file) return;
    StaticJsonDocument<1024> doc;
    DeserializationError error = deserializeJson(doc, file);
    file.close();
    if (error) {
      Serial.printf("[OFFLINE] Corrupt sample %s; inspect filesystem\n", keys[index]);
      return;
    }
    doc["replayed"] = true;
    char payload[896];
    if (measureJson(doc) >= sizeof(payload)) return;
    serializeJson(doc, payload);
    client.publish(topic, payload);
  }

 private:
  bool ready = false;
  char keys[CAPACITY][18];
  size_t count = 0, cursor = 0;
  unsigned long lastSend = 0;

  static String path(const char* key) { return String("/telemetry/") + key + ".json"; }
  static bool validKey(const char* key) {
    if (strlen(key) != 17) return false;
    for (size_t i = 0; i < 17; i++) if (key[i] < '0' || key[i] > '9') return false;
    return true;
  }
  static bool timestampKey(const char* ts, char* key) {
    size_t n = 0;
    for (const char* p = ts; *p; p++) {
      if (*p >= '0' && *p <= '9') {
        if (n >= 17) return false;
        key[n++] = *p;
      }
    }
    key[n] = 0;
    return n == 17;
  }
  void eraseIndex(size_t index) {
    for (size_t i = index + 1; i < count; i++) memcpy(keys[i - 1], keys[i], 18);
    count--;
    cursor = 0;
  }
  void remember(const char* key) {
    for (size_t i = 0; i < count; i++) if (!strcmp(keys[i], key)) return;
    if (count == CAPACITY) {
      // Preserve the newest CAPACITY records, including while scanning after reboot.
      if (strcmp(key, keys[0]) <= 0) {
        LittleFS.remove(path(key));
        Serial.println("[OFFLINE] Queue full: dropped oldest sample");
        return;
      }
      if (!LittleFS.remove(path(keys[0]))) {
        Serial.println("[OFFLINE] Cannot reclaim disk; queue remains full");
        LittleFS.remove(path(key));
        return;
      }
      eraseIndex(0);
      Serial.println("[OFFLINE] Queue full: dropped oldest sample");
    }
    size_t i = count;
    while (i > 0 && strcmp(keys[i - 1], key) > 0) { memcpy(keys[i], keys[i - 1], 18); i--; }
    strlcpy(keys[i], key, 18);
    count++;
  }
};
