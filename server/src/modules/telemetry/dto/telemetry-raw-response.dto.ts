import { Expose } from 'class-transformer';

export class TelemetryRawResponseDto {
  @Expose()
  deviceId!: string;

  @Expose()
  coldRoomId!: string;

  @Expose()
  ts!: Date;

  @Expose()
  temperature!: number | null;

  @Expose()
  doorOpen!: boolean;

  @Expose()
  sensorFault!: boolean;

  @Expose()
  outOfRange!: boolean;

  // null = not reported by the device (see telemetry-raw.schema.ts).
  @Expose()
  humidity!: number | null;

  @Expose()
  fanOn!: boolean | null;

  @Expose()
  fanVoltage!: number | null;

  @Expose()
  fanPowerFault!: boolean | null;

  @Expose()
  alarmActive!: boolean | null;
}
