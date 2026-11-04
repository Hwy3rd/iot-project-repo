export interface TemperatureHistoryReading {
  ts: string;
  temperature: number;
}

export interface AiPredictRequestDto {
  feature_schema: 'temperature-history-v1';
  temperature: number;
  temperature_history: TemperatureHistoryReading[];
  temp_min?: number;
  temp_max?: number;
}

export const AI_FORECAST_SCHEMA = 'temperature-warning-5-10-v1' as const;
export type ForecastHorizon = 5 | 10;
export type ForecastViolation = 'NONE' | 'OVERHEAT' | 'FREEZING';

export interface AiForecastPointDto {
  horizon_minutes: ForecastHorizon;
  predicted_temp: number;
  will_exceed_threshold: boolean;
  violation_type: ForecastViolation;
}

export interface AiPredictResponseDto {
  forecast_schema: typeof AI_FORECAST_SCHEMA;
  as_of: string;
  forecasts: AiForecastPointDto[];
  will_exceed_threshold: boolean;
  first_violation_minutes: ForecastHorizon | null;
  violation_type: ForecastViolation;
  risk_level: 'NORMAL' | 'WARNING' | 'CRITICAL';
  recommendation: string;
  metadata?: Record<string, unknown>;
}

// Validate HTTP/cache values before their temperatures can raise alerts.
export function isAiPredictResponse(
  value: unknown,
): value is AiPredictResponseDto {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AiPredictResponseDto>;
  if (
    data.forecast_schema !== AI_FORECAST_SCHEMA ||
    typeof data.as_of !== 'string' ||
    !Number.isFinite(Date.parse(data.as_of)) ||
    typeof data.recommendation !== 'string' ||
    !['NORMAL', 'WARNING', 'CRITICAL'].includes(data.risk_level ?? '') ||
    !Array.isArray(data.forecasts) ||
    data.forecasts.length !== 2
  )
    return false;
  const horizons = [5, 10];
  if (
    !data.forecasts.every(
      (point, i) =>
        point &&
        typeof point === 'object' &&
        point.horizon_minutes === horizons[i] &&
        Number.isFinite(point.predicted_temp) &&
        typeof point.will_exceed_threshold === 'boolean' &&
        ['NONE', 'OVERHEAT', 'FREEZING'].includes(point.violation_type) &&
        point.will_exceed_threshold === (point.violation_type !== 'NONE'),
    )
  )
    return false;
  const first = data.forecasts.find((point) => point.will_exceed_threshold);
  return (
    data.will_exceed_threshold === Boolean(first) &&
    data.first_violation_minutes === (first?.horizon_minutes ?? null) &&
    data.violation_type === (first?.violation_type ?? 'NONE')
  );
}

export interface ColdRoomForecast {
  horizonMinutes: ForecastHorizon;
  predictedTemp: number;
  willExceedThreshold: boolean;
  violationType: ForecastViolation;
}

// What the cold-room chart shows (GET /cold-rooms/:id/telemetry → prediction).
// Kept here rather than in cold-rooms so the telemetry side can store it
// without importing the cold-rooms module.
export interface ColdRoomPrediction {
  // Timestamp of the latest input reading; each point is relative to it.
  predictedAt: Date;
  forecasts: ColdRoomForecast[];
  firstViolationMinutes: ForecastHorizon | null;
  willExceedThreshold: boolean;
  violationType: string;
  riskLevel: string;
  recommendation: string;
}
