export const TELEMETRY_RAW_COLLECTION = 'telemetry_raw';
export const TELEMETRY_HOURLY_COLLECTION = 'telemetry_hourly';

export const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Raw samples are only kept long enough to investigate an incident and to
// recompute recent hourly buckets; the hourly collection is the permanent
// record. Changing this later needs a `collMod` on the existing TTL index —
// Mongoose will not update an index whose options changed.
export const TELEMETRY_RAW_TTL_DAYS = 30;

// The rollup job re-aggregates this many closed hours on every run, so late
// samples and a worker that was down for a few hours are healed automatically.
export const TELEMETRY_ROLLUP_LOOKBACK_HOURS = 3;

export const TELEMETRY_HOURLY_DEFAULT_RANGE_MS = DAY_MS;
export const TELEMETRY_HOURLY_MAX_RANGE_MS = 366 * DAY_MS;

export const TELEMETRY_RAW_DEFAULT_RANGE_MS = HOUR_MS;
export const TELEMETRY_RAW_MAX_RANGE_MS = 6 * HOUR_MS;
export const TELEMETRY_RAW_DEFAULT_LIMIT = 1000;
export const TELEMETRY_RAW_MAX_LIMIT = 5000;
