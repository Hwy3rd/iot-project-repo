#include <cassert>
#include <cmath>
#include <iostream>
#include "../cold_room_monitor/fan_thermostat.h"

int main() {
  // Boot inside the normal range: ON. Only readings below tempMin stop it.
  FanThermostat fan;
  assert(fan.update(29.0f, 28.0f));
  assert(fan.update(30.0f, 28.0f));
  assert(fan.update(31.0f, 28.0f));
  assert(fan.update(28.0f, 28.0f));
  assert(!fan.update(27.9f, 28.0f));
  assert(!fan.update(27.0f, 28.0f));
  assert(fan.update(28.0f, 28.0f));  // Restart at the lower limit itself.
  assert(!fan.update(27.9f, 28.0f));
  assert(fan.update(28.1f, 28.0f));  // No waiting for the upper limit.

  // Boot below the lower limit: OFF immediately.
  FanThermostat coldStartup;
  assert(!coldStartup.update(27.0f, 28.0f));
  assert(coldStartup.update(29.0f, 28.0f));

  // Sensor outages default to ON, even after a low reading stopped the fan.
  FanThermostat startup;
  assert(startup.update(NAN, 28.0f));
  assert(!startup.update(27.0f, 28.0f));
  assert(startup.update(NAN, 28.0f));
  assert(startup.update(INFINITY, 28.0f));
  assert(startup.update(-INFINITY, 28.0f));
  assert(!startup.update(27.0f, 28.0f));  // Valid readings recover normally.

  // Updated lower limits take effect immediately in both directions.
  assert(!fan.update(29.0f, 30.0f));
  assert(fan.update(29.0f, 28.0f));
  assert(!fan.update(23.0f, 24.0f));
  assert(fan.update(23.0f, 22.0f));
  assert(fan.update(0.0f, NAN));
  assert(fan.update(0.0f, INFINITY));
  assert(fan.update(0.0f, -INFINITY));

  // Negative cold-room temperatures use the same lower-limit rule.
  FanThermostat frozen;
  assert(frozen.update(-20.0f, -22.0f));
  assert(!frozen.update(-23.0f, -22.0f));
  assert(frozen.update(-22.0f, -22.0f));
  assert(frozen.update(-21.9f, -22.0f));

  std::cout << "PASS: default ON, lower-limit stop/restart, startup, sensor outages, config updates, negative temperatures\n";
}
