#include <cassert>
#include <cmath>
#include <iostream>
#include "../cold_room_monitor/fan_thermostat.h"

int main() {
  // A complete cooling cycle with noisy readings around both limits.
  FanThermostat fan;
  assert(!fan.update(29.0f, 28.0f, 30.0f));  // Boot inside the band: OFF.
  assert(!fan.update(30.0f, 28.0f, 30.0f));
  assert(fan.update(30.1f, 28.0f, 30.0f));
  assert(fan.update(29.9f, 28.0f, 30.0f));
  assert(fan.update(28.0f, 28.0f, 30.0f));
  assert(!fan.update(27.9f, 28.0f, 30.0f));
  assert(!fan.update(28.1f, 28.0f, 30.0f));
  assert(!fan.update(30.0f, 28.0f, 30.0f));
  assert(fan.update(31.0f, 28.0f, 30.0f));

  // Sensor outages hold the last demand, including before the first reading.
  assert(fan.update(NAN, 28.0f, 30.0f));
  assert(fan.update(INFINITY, 28.0f, 30.0f));
  FanThermostat startup;
  assert(!startup.update(NAN, 28.0f, 30.0f));
  assert(startup.update(31.0f, 28.0f, 30.0f));
  assert(!startup.update(27.0f, 28.0f, 30.0f));
  assert(!startup.update(NAN, 28.0f, 30.0f));

  // A new backend configuration takes effect on the next sensor evaluation.
  assert(!fan.update(29.0f, 30.0f, 32.0f));
  assert(fan.update(29.0f, 24.0f, 26.0f));
  assert(fan.update(25.0f, 24.0f, 26.0f));
  assert(!fan.update(23.0f, 24.0f, 26.0f));
  // Bad bounds cannot change demand; a later valid config recovers normally.
  assert(!fan.update(31.0f, 32.0f, 30.0f));
  assert(!fan.update(31.0f, 30.0f, 30.0f));
  assert(!fan.update(31.0f, NAN, 30.0f));
  assert(!fan.update(31.0f, 28.0f, INFINITY));
  assert(fan.update(31.0f, 28.0f, 30.0f));
  assert(fan.update(0.0f, 32.0f, 30.0f));

  // Negative cold-room temperatures must use the same switching rules.
  FanThermostat frozen;
  assert(frozen.update(-17.0f, -22.0f, -18.0f));
  assert(frozen.update(-20.0f, -22.0f, -18.0f));
  assert(!frozen.update(-23.0f, -22.0f, -18.0f));

  // No room config: use finite fallback bounds, not the alarm's -INFINITY.
  FanThermostat fallback;
  assert(!fallback.update(40.0f, 39.0f, 40.0f));
  assert(fallback.update(40.1f, 39.0f, 40.0f));
  assert(fallback.update(39.0f, 39.0f, 40.0f));
  assert(!fallback.update(38.9f, 39.0f, 40.0f));

  std::cout << "PASS: cooling cycles, boundaries, sensor outages, room config updates, invalid config, negative temperatures, fallback\n";
}
