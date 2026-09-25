import { IsIn, IsOptional } from 'class-validator';

export const TELEMETRY_RANGES = ['1h', '6h', '24h'] as const;
export type TelemetryRange = (typeof TELEMETRY_RANGES)[number];

export class QueryColdRoomTelemetryDto {
  // Window ending now. Each maps to a fixed bucket size (see
  // ColdRoomStatusService.RANGE_BUCKETS) so a chart gets ~60-100 points.
  @IsOptional()
  @IsIn(TELEMETRY_RANGES)
  range?: TelemetryRange;
}
