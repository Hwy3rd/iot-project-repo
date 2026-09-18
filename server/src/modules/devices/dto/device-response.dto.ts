import { Expose } from 'class-transformer';
import { DeviceStatus } from '../../../libs/constants/device.constant';

export class DeviceResponseDto {
  @Expose()
  id!: string;

  @Expose()
  uniqueId!: string;

  @Expose()
  coldRoomId!: string | null;

  @Expose()
  firmwareVersion!: string | null;

  @Expose()
  status!: DeviceStatus;

  @Expose()
  lastHeartbeatAt!: Date | null;

  @Expose()
  claimCodeExpiresAt!: Date | null;

  @Expose()
  claimedAt!: Date | null;

  @Expose()
  decommissionedAt!: Date | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}
