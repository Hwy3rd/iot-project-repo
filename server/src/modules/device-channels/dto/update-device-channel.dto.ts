import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateDeviceChannelDto } from './create-device-channel.dto';

// channelType is immutable once created: it defines what physical
// peripheral this channel represents, which future readings/commands will
// key off of. A rewired peripheral should get a new channel, not a
// retyped one — only label can be edited.
export class UpdateDeviceChannelDto extends PartialType(
  OmitType(CreateDeviceChannelDto, ['channelType']),
) {}
