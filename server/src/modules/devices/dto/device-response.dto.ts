import { Expose, Type } from 'class-transformer';
import { MqttCredentialsDto } from './mqtt-credentials.dto';
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

  // Only on create, when the broker manages device accounts: null = the
  // account could not be made (re-issue it later). Never stored.
  @Expose()
  @Type(() => MqttCredentialsDto)
  mqttCredentials?: MqttCredentialsDto | null;
}
