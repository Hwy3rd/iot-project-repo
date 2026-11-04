#include <cassert>
#include <iostream>
#include "../cold_room_monitor/offline_telemetry.h"

unsigned long testMillis = 10000;
TestFilesystem LittleFS;

static const char* TS = "2026-11-04T03:00:00.000Z";
static const char* PAYLOAD = "{\"ts\":\"2026-11-04T03:00:00.000Z\",\"temperature\":5.2,\"replayed\":false}";
static void reset() { LittleFS = TestFilesystem(); testMillis = 10000; }

int main() {
  // Lost WiFi + reboot: recover the committed sample, keep ts, await app ACK.
  reset();
  {
    OfflineTelemetryQueue queue;
    assert(queue.begin()); assert(queue.append(TS, PAYLOAD));
    queue.flushOne(false, [](const char*) { assert(false); return false; });
  }
  testMillis += 10000;
  OfflineTelemetryQueue recovered;
  assert(recovered.begin());
  std::string sent;
  recovered.flushOne(true, [&](const char* p) { sent = p; return true; });
  assert(sent.find(TS) != std::string::npos);
  assert(sent.find("\"replayed\":true") != std::string::npos);
  assert(sent.find("5.2") != std::string::npos);
  assert(LittleFS.files.size() == 1);
  recovered.acknowledge(TS, "PUBACK");  // Broker ACK cannot erase data.
  recovered.acknowledge("bad timestamp", "stored");
  assert(LittleFS.files.size() == 1);
  recovered.acknowledge(TS, "stored");
  assert(LittleFS.files.empty());

  // Failed publication and missing backend ACK remain retryable, with pacing.
  reset();
  OfflineTelemetryQueue retry;
  assert(retry.begin()); assert(retry.append(TS, PAYLOAD));
  int attempts = 0;
  auto fail = [&](const char*) { attempts++; return false; };
  retry.flushOne(true, fail); assert(attempts == 0);
  testMillis += 5000; retry.flushOne(true, fail); assert(attempts == 1);
  testMillis += 250; retry.flushOne(true, fail); assert(attempts == 1);
  testMillis += 4750; retry.flushOne(true, fail); assert(attempts == 2);
  assert(LittleFS.files.size() == 1);
  retry.acknowledge(TS, "discarded"); assert(LittleFS.files.empty());

  // Interrupted commits never become replayable measurements or format flash.
  for (int fault = 0; fault < 2; fault++) {
    reset();
    OfflineTelemetryQueue queue; assert(queue.begin());
    LittleFS.failWrite = fault == 0; LittleFS.failRename = fault == 1;
    assert(!queue.append(TS, PAYLOAD));
    assert(LittleFS.files.empty());
    assert(!LittleFS.formatRequested);
  }
  reset(); LittleFS.mountOK = false;
  OfflineTelemetryQueue unavailable;
  assert(!unavailable.begin()); assert(!unavailable.append(TS, PAYLOAD));
  assert(!LittleFS.formatRequested);

  // Overflow keeps the latest 720 records; reset must not bring evicted data back.
  reset();
  OfflineTelemetryQueue bounded; assert(bounded.begin());
  for (int i = 0; i < 721; i++) {
    char ts[32]; snprintf(ts, sizeof(ts), "2026-11-04T03:00:00.%03dZ", i);
    assert(bounded.append(ts, "{\"temperature\":5.2}"));
  }
  assert(LittleFS.files.size() == 720);
  assert(!LittleFS.exists("/telemetry/20261104030000000.json"));
  assert(LittleFS.exists("/telemetry/20261104030000720.json"));
  OfflineTelemetryQueue rebooted; assert(rebooted.begin());
  assert(LittleFS.files.size() == 720);

  // Corruption cannot block unrelated pending samples in the round-robin queue.
  reset();
  OfflineTelemetryQueue roundRobin; assert(roundRobin.begin());
  assert(roundRobin.append(TS, "corrupt"));
  assert(roundRobin.append("2026-11-04T03:00:01.000Z", PAYLOAD));
  testMillis += 5000; int delivered = 0;
  auto publish = [&](const char*) { delivered++; return true; };
  roundRobin.flushOne(true, publish); assert(delivered == 0);
  testMillis += 250; roundRobin.flushOne(true, publish); assert(delivered == 1);

  std::cout << "PASS: offline persistence, reboot, ACK, retry pacing, write failures, mount failure, overflow, corruption\n";
}
