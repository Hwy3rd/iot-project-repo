import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { TELEMETRY_RAW_MAX_LIMIT } from '../../../libs/constants/telemetry.constant';

export class QueryTelemetryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class QueryRawTelemetryDto extends QueryTelemetryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TELEMETRY_RAW_MAX_LIMIT)
  limit?: number;
}
