#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <LittleFS.h>

// All methods run on loop(), never on the esp-mqtt event task. No automatic
// formatting: a mount failure must not erase measurements waiting for an ACK.
class OfflineTelemetryQueue {
 public:
  static const size_t CAPACITY = 720;

  bool begin() {
    ready = LittleFS.begin(false);
    if (!ready) {
      Serial.println("[OFFLINE] LittleFS unavailable; prepare a filesystem partition. Telemetry is NOT durable.");
      return false;
    }
    if (!LittleFS.exists("/telemetry") && !LittleFS.mkdir("/telemetry")) {
      ready = false;
      Serial.println("[OFFLINE] Cannot create telemetry directory; telemetry is NOT durable.");
      return false;
    }
    File directory = LittleFS.open("/telemetry");
    if (!directory || !directory.isDirectory()) {
      ready = false;
      return false;
    }
    count = cursor = 0;
    for (File file = directory.openNextFile(); file; file = directory.openNextFile()) {
      String name = file.name();
      int slash = name.lastIndexOf('/');
      if (slash >= 0) name = name.substring(slash + 1);
      if (name.length() == 22 && name.endsWith(".json")) {
        String key = name.substring(0, 17);
        if (validKey(key.c_str())) remember(key.c_str(), 0);
      }
      file.close();
    }
    directory.close();
    // A temp file has not been committed and must never be replayed as a sample.
    LittleFS.remove("/telemetry/pending.tmp");
    Serial.printf("[OFFLINE] Recovered %u pending samples\n", (unsigned)count);
    return true;
  }

  bool append(const char* ts, const char* payload) {
    if (!ready) return false;
    char key[18];
    if (!timestampKey(ts, key)) return false;
    String target = path(key);
    if (LittleFS.exists(target)) return true;
    // Reclaim before writing so capacity overflow can still accept a new sample.
    if (count == CAPACITY && !dropOldest()) return false;
    File file = LittleFS.open("/telemetry/pending.tmp", "w");
    if (!file) return false;
    size_t written = file.print(payload);
    file.flush();
    file.close();
    if (written != strlen(payload) || !LittleFS.rename("/telemetry/pending.tmp", target)) {
      Serial.println("[OFFLINE] Disk write failed; pending sample was not committed");
      LittleFS.remove("/telemetry/pending.tmp");
      return false;
    }
    remember(key, millis());
    return true;
  }

  void acknowledge(const char* ts, const char* status) {
    if (!ready || (strcmp(status, "stored") && strcmp(status, "discarded"))) return;
    char key[18];
    if (!timestampKey(ts, key)) return;
    for (size_t i = 0; i < count; i++) {
      if (strcmp(keys[i], key)) continue;
      if (!strcmp(status, "discarded"))
        Serial.printf("[OFFLINE] Server discarded %s (timestamp/room/lifecycle)\n", ts);
      if (LittleFS.remove(path(key))) eraseIndex(i);
      return;
    }
  }

  // Round-robin prevents one unacknowledged sample blocking every other sample.
  // Fresh live samples get 5s for their ACK before replay; pacing bounds traffic.
  template <typename Publish>
  void flushOne(bool connected, Publish publish) {
    unsigned long now = millis();
    if (!ready || !count || !connected || now - lastSend < 250) return;
    for (size_t checked = 0; checked < count; checked++) {
      if (cursor >= count) cursor = 0;
      size_t index = cursor++;
      if (now - lastAttempt[index] < 5000) continue;
      lastSend = lastAttempt[index] = now;
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
      publish(payload);  // Failure leaves the durable sample available for retry.
      return;
    }
  }

 private:
  bool ready = false;
  char keys[CAPACITY][18];
  unsigned long lastAttempt[CAPACITY] = {};
  size_t count = 0, cursor = 0;
  unsigned long lastSend = 0;

  static String path(const char* key) { return String("/telemetry/") + key + ".json"; }
  static bool validKey(const char* key) {
    if (strlen(key) != 17) return false;
    for (size_t i = 0; i < 17; i++) if (key[i] < '0' || key[i] > '9') return false;
    return true;
  }
  static bool timestampKey(const char* ts, char* key) {
    // Only canonical UTC milliseconds (the format also used by backend ACKs).
    if (strlen(ts) != 24 || ts[4] != '-' || ts[7] != '-' || ts[10] != 'T' ||
        ts[13] != ':' || ts[16] != ':' || ts[19] != '.' || ts[23] != 'Z') return false;
    size_t n = 0;
    for (size_t i = 0; i < 24; i++) {
      if (i == 4 || i == 7 || i == 10 || i == 13 || i == 16 || i == 19 || i == 23) continue;
      if (ts[i] < '0' || ts[i] > '9') return false;
      key[n++] = ts[i];
    }
    key[n] = 0;
    return n == 17;
  }
  void eraseIndex(size_t index) {
    for (size_t i = index + 1; i < count; i++) {
      memcpy(keys[i - 1], keys[i], 18);
      lastAttempt[i - 1] = lastAttempt[i];
    }
    count--;
    cursor = 0;
  }
  bool dropOldest() {
    if (!LittleFS.remove(path(keys[0]))) {
      Serial.println("[OFFLINE] Cannot reclaim disk; queue remains full");
      return false;
    }
    eraseIndex(0);
    Serial.println("[OFFLINE] Queue full: dropped oldest sample");
    return true;
  }
  void remember(const char* key, unsigned long attemptedAt) {
    for (size_t i = 0; i < count; i++) if (!strcmp(keys[i], key)) return;
    if (count == CAPACITY) {
      // During recovery, retain the newest records regardless of directory order.
      if (strcmp(key, keys[0]) <= 0 || !dropOldest()) {
        LittleFS.remove(path(key));
        return;
      }
    }
    size_t i = count;
    while (i > 0 && strcmp(keys[i - 1], key) > 0) {
      memcpy(keys[i], keys[i - 1], 18);
      lastAttempt[i] = lastAttempt[i - 1];
      i--;
    }
    strlcpy(keys[i], key, 18);
    lastAttempt[i] = attemptedAt;
    count++;
  }
};
