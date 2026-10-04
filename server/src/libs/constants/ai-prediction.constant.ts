// Background HTTP requests retain their timeout and circuit breaker.
export const AI_PREDICTION_TIMEOUT_MS = 1500;
export const AI_PREDICTION_FAILURE_THRESHOLD = 3;
export const AI_PREDICTION_COOLDOWN_MS = 30_000;

// Bangkok T_MS + T_FC input coverage. A tree ensemble cannot extrapolate.
export const AI_PREDICTION_SUPPORTED_MIN_TEMP = -28;
export const AI_PREDICTION_SUPPORTED_MAX_TEMP = 19.6;
export const AI_PREDICTION_FEATURE_SCHEMA = 'temperature-history-v1' as const;

// Current + twelve past readings: t-60, t-55, ..., t minutes. Firmware
// publishes every five seconds, so sample by timestamp, never by row count.
export const AI_PREDICTION_HISTORY_SAMPLES = 13;
export const AI_PREDICTION_HISTORY_WINDOW_MS = 60 * 60_000;
export const AI_PREDICTION_SAMPLE_INTERVAL_MS = 5 * 60_000;
export const AI_PREDICTION_SAMPLE_MAX_AGE_MS = 60_000;
// Includes a minute of slack for the oldest checkpoint. At the firmware's
// 5s cadence this is 733 rows; the cap also covers one reading per second.
export const AI_PREDICTION_HISTORY_MAX_ROWS = 5000;
export const AI_PREDICTION_MIN_INTERVAL_MS = 60_000;
export const AI_PREDICTION_TTL_SECONDS = 15 * 60;
