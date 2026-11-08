#pragma once
#include <math.h>

// Local cooling demand, independent of WiFi and temporary manual overrides.
// The room's lower/upper limits form the switching band; alarm hysteresis
// remains separate. Start OFF until a valid reading exceeds the upper limit.
class FanThermostat {
 public:
  bool update(float temperature, float tempMin, float tempMax) {
    // Missing readings must not invent a new cooling state.
    if (!isfinite(temperature) || !isfinite(tempMin) || !isfinite(tempMax) ||
        tempMin >= tempMax) return cooling;
    if (temperature > tempMax) cooling = true;
    else if (temperature < tempMin) cooling = false;
    return cooling;
  }

 private:
  bool cooling = false;
};
