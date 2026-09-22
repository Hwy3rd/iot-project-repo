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
}
