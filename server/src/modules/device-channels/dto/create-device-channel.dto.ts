import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ChannelType } from '../../../libs/constants/device-channel.constant';

export class CreateDeviceChannelDto {
  @IsEnum(ChannelType)
  channelType!: ChannelType;

  @IsOptional()
  @IsString()
  label?: string;
}
