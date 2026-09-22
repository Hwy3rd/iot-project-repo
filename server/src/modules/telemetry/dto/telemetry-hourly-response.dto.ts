import { Expose } from 'class-transformer';

export class TelemetryHourlyResponseDto {
  @Expose()
  deviceId!: string;

  @Expose()
  coldRoomId!: string;

  @Expose()
  hourBucket!: Date;

  @Expose()
  sampleCount!: number;

  @Expose()
  avgTemp!: number | null;

  @Expose()
  minTemp!: number | null;

  @Expose()
  maxTemp!: number | null;

  @Expose()
  outOfRangeCount!: number;

  @Expose()
  sensorErrorCount!: number;
}
