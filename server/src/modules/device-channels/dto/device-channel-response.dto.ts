import { Expose } from 'class-transformer';
import {
  ChannelRole,
  ChannelType,
} from '../../../libs/constants/device-channel.constant';

export class DeviceChannelResponseDto {
  @Expose()
  id!: string;

  @Expose()
  deviceId!: string;

  @Expose()
  channelType!: ChannelType;

  @Expose()
  channelRole!: ChannelRole;

  @Expose()
  label!: string | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}
