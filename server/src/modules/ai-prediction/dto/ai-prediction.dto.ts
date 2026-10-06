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

export interface AiPredictResponseDto {
  predicted_temp_15m: number;
  will_exceed_threshold: boolean;
  violation_type: 'NONE' | 'OVERHEAT' | 'FREEZING';
  risk_level: 'NORMAL' | 'WARNING' | 'CRITICAL';
  recommendation: string;
  metadata?: Record<string, unknown>;
}

// What the cold-room chart shows (GET /cold-rooms/:id/telemetry → prediction).
// Kept here rather than in cold-rooms so the telemetry side can store it
// without importing the cold-rooms module.
export interface ColdRoomPrediction {
  // When the forecast was made; predictedTemp15m is for 15 minutes later.
  predictedAt: Date;
  predictedTemp15m: number;
  willExceedThreshold: boolean;
  violationType: string;
  riskLevel: string;
  recommendation: string;
}
