import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

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

  // Optional device state below: only the ESP32 firmware since v1.1 sends
  // these, so older firmware and the simulators omit them. Missing and
  // `null` both mean "not reported" and are stored as null, never as a
  // made-up 0/false.

  // Relative humidity (%), from the same DHT sensor; null on a failed read.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  humidity?: number | null;

  // Whether the fan relay is switched on.
  @IsOptional()
  @IsBoolean()
  fanOn?: boolean | null;

  // Supply voltage measured at the fan (V).
  @IsOptional()
  @IsNumber()
  @Min(0)
  fanVoltage?: number | null;

  // The fan is switched on but its supply dropped or spiked.
  @IsOptional()
  @IsBoolean()
  fanPowerFault?: boolean | null;

  // The device's local buzzer alarm is sounding (door open, over-temperature
  // or fan power fault, as judged on the device itself).
  @IsOptional()
  @IsBoolean()
  alarmActive?: boolean | null;
}
