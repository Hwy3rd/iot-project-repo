import { Expose } from 'class-transformer';
import {
  DeviceStatus,
  DeviceStatusChangeTrigger,
} from '../../../libs/constants/device.constant';

export class DeviceStatusHistoryResponseDto {
  @Expose()
  id!: string;

  @Expose()
  deviceId!: string;

  @Expose()
  oldStatus!: DeviceStatus | null;

  @Expose()
  newStatus!: DeviceStatus;

  @Expose()
  changedBy!: string | null;

  @Expose()
  trigger!: DeviceStatusChangeTrigger;

  @Expose()
  reason!: string | null;

  @Expose()
  changedAt!: Date;
}
