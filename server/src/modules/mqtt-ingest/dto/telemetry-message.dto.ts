import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsNumber, ValidateIf } from 'class-validator';

// Shape of the JSON payload published by a device to `devices/{uniqueId}/telemetry`
// — kept 1:1 with TelemetryService's `TelemetrySample` interface, since that's
// what a validated instance of this DTO gets passed as.
export class TelemetryMessageDto {
  @Type(() => Date)
  @IsDate()
  ts!: Date;

  // Required but nullable: the device reports `null` itself for a faulty
  // reading rather than omitting the field.
  @ValidateIf((dto: TelemetryMessageDto) => dto.temperature !== null)
  @IsNumber()
  temperature!: number | null;

  @IsBoolean()
  doorOpen!: boolean;

  @IsBoolean()
  sensorFault!: boolean;
}
