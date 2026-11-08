export type AiForecastStatusCode =
  | 'ready'
  | 'collecting_data'
  | 'unsupported_range'
  | 'no_device'
  | 'no_data'
  | 'stale_data'
  | 'prediction_expired'
  | 'sensor_error'
  | 'temperature_out_of_range'
  | 'service_unavailable'
  | 'unavailable'
  | 'pending';

export interface AiForecastStatus {
  code: AiForecastStatusCode;
  checkedAt: Date;
  deviceUniqueId?: string;
  lastReadingAt?: Date;
  collectedSamples?: number;
  requiredSamples?: number;
  requiredHistoryMinutes?: number;
  supportedMinTemp?: number;
  supportedMaxTemp?: number;
  currentTemp?: number;
  tempMin?: number;
  tempMax?: number;
  reason?: 'room_thresholds' | 'current_reading';
}
