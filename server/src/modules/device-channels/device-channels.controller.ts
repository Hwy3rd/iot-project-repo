import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { DeviceChannelsService } from './device-channels.service';
import { CreateDeviceChannelDto } from './dto/create-device-channel.dto';
import { DeviceChannelResponseDto } from './dto/device-channel-response.dto';
import { UpdateDeviceChannelDto } from './dto/update-device-channel.dto';

@Controller('devices/:deviceId/channels')
export class DeviceChannelsController {
  constructor(private readonly deviceChannelsService: DeviceChannelsService) {}

  @Serialize(DeviceChannelResponseDto)
  @Post()
  create(
    @Param('deviceId') deviceId: string,
    @Body() createDeviceChannelDto: CreateDeviceChannelDto,
  ) {
    return this.deviceChannelsService.create(deviceId, createDeviceChannelDto);
  }

  @Serialize(DeviceChannelResponseDto)
  @Get()
  findAll(@Param('deviceId') deviceId: string) {
    return this.deviceChannelsService.findAllForDevice(deviceId);
  }

  @Serialize(DeviceChannelResponseDto)
  @Get(':id')
  findOne(@Param('deviceId') deviceId: string, @Param('id') id: string) {
    return this.deviceChannelsService.findOne(deviceId, id);
  }

  @Serialize(DeviceChannelResponseDto)
  @Patch(':id')
  update(
    @Param('deviceId') deviceId: string,
    @Param('id') id: string,
    @Body() updateDeviceChannelDto: UpdateDeviceChannelDto,
  ) {
    return this.deviceChannelsService.update(
      deviceId,
      id,
      updateDeviceChannelDto,
    );
  }

  @Delete(':id')
  remove(@Param('deviceId') deviceId: string, @Param('id') id: string) {
    return this.deviceChannelsService.remove(deviceId, id);
  }
}
