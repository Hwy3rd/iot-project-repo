export interface AiPredictRequestDto {
  temperature: number;
  temp_min?: number;
  temp_max?: number;
  humidity?: number;
  ambient_temp?: number;
  temp_delta?: number;
  temp_moving_avg?: number;
  hour_of_day?: number;
}

export interface AiPredictResponseDto {
  predicted_temp_15m: number;
  will_exceed_threshold: boolean;
  violation_type: 'NONE' | 'OVERHEAT' | 'FREEZING';
  risk_level: 'NORMAL' | 'WARNING' | 'CRITICAL';
  recommendation: string;
  metadata?: Record<string, unknown>;
}
