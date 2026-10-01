// One forecast call must never hold anything up for long — it runs off the
// ingest path, but a hung request still keeps a slot busy (see the in-flight
// guard in TelemetryService).
export const AI_PREDICTION_TIMEOUT_MS = 1500;

// Circuit breaker: after this many consecutive failures the client stops
// calling the AI service for AI_PREDICTION_COOLDOWN_MS, so a down service
// costs one log line per cooldown instead of a timeout per reading.
export const AI_PREDICTION_FAILURE_THRESHOLD = 3;
export const AI_PREDICTION_COOLDOWN_MS = 30_000;

// The current model was trained on 2-8°C cold-chain data and cannot
// extrapolate: below about -4°C it answers a constant ~-4°C (it's a tree
// ensemble), so every reading of a frozen room (-22..-18°C) would be
// "forecast" as a +14°C overheat. Only rooms whose whole range sits inside
// what the model has seen get forecasts. Revisit after retraining on our own
// telemetry (which covers frozen rooms).
export const AI_PREDICTION_SUPPORTED_MIN_TEMP = 0;
export const AI_PREDICTION_SUPPORTED_MAX_TEMP = 15;

// The model's trend features (temp_delta = T_t - T_{t-1}, temp_moving_avg
// over 5 cycles) are built from the device's own recent readings. Readings
// older than the window don't count, so a device coming back after a gap
// isn't given a "trend" spanning hours — with fewer than
// AI_PREDICTION_MIN_SAMPLES in the window no forecast is made.
export const AI_PREDICTION_HISTORY_SAMPLES = 5;
export const AI_PREDICTION_MIN_SAMPLES = 2;
export const AI_PREDICTION_HISTORY_WINDOW_MS = 15 * 60_000;

// Matches the forecast horizon: a forecast older than 15 minutes is about a
// moment that has already passed.
export const AI_PREDICTION_TTL_SECONDS = 15 * 60;
