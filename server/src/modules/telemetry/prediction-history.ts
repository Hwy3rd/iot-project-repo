import {
  AI_PREDICTION_HISTORY_SAMPLES,
  AI_PREDICTION_SAMPLE_INTERVAL_MS,
  AI_PREDICTION_SAMPLE_MAX_AGE_MS,
  AI_PREDICTION_SUPPORTED_MAX_TEMP,
  AI_PREDICTION_SUPPORTED_MIN_TEMP,
} from '../../libs/constants/ai-prediction.constant';
import { TemperatureHistoryReading } from '../ai-prediction/dto/ai-prediction.dto';

interface Reading {
  ts: Date;
  temperature: number | null;
}

// Returns actual source timestamps, oldest first, without interpolation or
// future values. Missing/stale checkpoints leave the forecast unavailable.
export function samplePredictionHistory(
  rows: Reading[],
  asOf: Date,
  currentTemperature: number,
): TemperatureHistoryReading[] | null {
  const valid = rows
    .filter(
      (row) =>
        row.ts instanceof Date &&
        Number.isFinite(row.ts.getTime()) &&
        typeof row.temperature === 'number' &&
        Number.isFinite(row.temperature) &&
        row.temperature >= AI_PREDICTION_SUPPORTED_MIN_TEMP &&
        row.temperature <= AI_PREDICTION_SUPPORTED_MAX_TEMP,
    )
    .sort((a, b) => b.ts.getTime() - a.ts.getTime());
  const selected: TemperatureHistoryReading[] = [];
  let cursor = 0;
  for (let lag = 0; lag < AI_PREDICTION_HISTORY_SAMPLES; lag++) {
    const checkpoint = asOf.getTime() - lag * AI_PREDICTION_SAMPLE_INTERVAL_MS;
    while (cursor < valid.length && valid[cursor].ts.getTime() > checkpoint) {
      cursor++;
    }
    const row = valid[cursor];
    if (
      !row ||
      checkpoint - row.ts.getTime() > AI_PREDICTION_SAMPLE_MAX_AGE_MS
    ) {
      return null;
    }
    if (
      lag === 0 &&
      (row.ts.getTime() !== asOf.getTime() ||
        Math.abs((row.temperature as number) - currentTemperature) > 1e-9)
    ) {
      return null;
    }
    selected.push({
      ts: row.ts.toISOString(),
      temperature: row.temperature as number,
    });
    cursor++;
  }
  return selected.reverse();
}
