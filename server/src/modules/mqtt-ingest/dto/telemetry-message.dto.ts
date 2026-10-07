import { Type } from 'class-transformer';
import {
  FAN_FAULTS,
  type FanFault,
} from '../../../libs/constants/device.constant';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
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

  // Whether the fan is actually running: judged from the measured supply
  // voltage since firmware v1.3 (before that: the relay state).
  @IsOptional()
  @IsBoolean()
  fanOn?: boolean | null;

  // Whether the device drives the fan relay on (firmware v1.3+).
  @IsOptional()
  @IsBoolean()
  fanRelayOn?: boolean | null;

  // Supply voltage measured at the fan (V).
  @IsOptional()
  @IsNumber()
  @Min(0)
  fanVoltage?: number | null;

  // Something is wrong with the fan supply (see fanFault for what).
  @IsOptional()
  @IsBoolean()
  fanPowerFault?: boolean | null;

  // Which supply fault (firmware v1.3+); null = none.
  @IsOptional()
  @IsIn([...FAN_FAULTS])
  fanFault?: FanFault | null;

  // The device's local buzzer alarm is sounding (door open, over-temperature
  // or fan power fault, as judged on the device itself).
  @IsOptional()
  @IsBoolean()
  alarmActive?: boolean | null;

  // Seconds left of a manual on/off command overriding the fan / buzzer's
  // automatic logic; 0 = running automatically (firmware v1.3+).
  @IsOptional()
  @IsInt()
  @Min(0)
  fanManualSec?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  buzzerManualSec?: number | null;

  // `version` of the room config the device alarms on (see
  // DeviceConfigService); null = still on its built-in fallback thresholds.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  configVersion?: string | null;
}
