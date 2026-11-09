#pragma once
#include <math.h>

// Run by default; stop only when a valid reading is below the room's lower
// limit. The upper limit and alarm hysteresis do not control the fan.
class FanThermostat {
 public:
  bool update(float temperature, float tempMin) const {
    // Without a valid reading/limit, there is no evidence the room is too cold.
    return !isfinite(temperature) || !isfinite(tempMin) || temperature >= tempMin;
  }
};
