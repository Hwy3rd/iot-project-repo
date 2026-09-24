import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Audit } from '../../common/decorators/audit.decorator';
import { DeviceChannel } from './entities/device-channel.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { DeviceChannelsService } from './device-channels.service';
import { CreateDeviceChannelDto } from './dto/create-device-channel.dto';
import { DeviceChannelResponseDto } from './dto/device-channel-response.dto';
import { UpdateDeviceChannelDto } from './dto/update-device-channel.dto';

const CHANNEL_VIEW_ROLES = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.TECHNICIAN,
];
const CHANNEL_MANAGE_ROLES = [UserRole.ADMIN, UserRole.TECHNICIAN];

@Controller('devices/:deviceId/channels')
export class DeviceChannelsController {
  constructor(private readonly deviceChannelsService: DeviceChannelsService) {}

  @Roles(...CHANNEL_MANAGE_ROLES)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM, {
    paramName: 'deviceId',
  })
  @Serialize(DeviceChannelResponseDto)
  @Audit({
    action: 'device_channel.create',
    targetType: 'device_channel',
    entity: DeviceChannel,
  })
  @Post()
  create(
    @Param('deviceId') deviceId: string,
    @Body() createDeviceChannelDto: CreateDeviceChannelDto,
  ) {
    return this.deviceChannelsService.create(deviceId, createDeviceChannelDto);
  }

  @Roles(...CHANNEL_VIEW_ROLES)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM, {
    paramName: 'deviceId',
  })
  @Serialize(DeviceChannelResponseDto)
  @Get()
  findAll(@Param('deviceId') deviceId: string) {
    return this.deviceChannelsService.findAllForDevice(deviceId);
  }

  @Roles(...CHANNEL_VIEW_ROLES)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM, {
    paramName: 'deviceId',
  })
  @Serialize(DeviceChannelResponseDto)
  @Get(':id')
  findOne(@Param('deviceId') deviceId: string, @Param('id') id: string) {
    return this.deviceChannelsService.findOne(deviceId, id);
  }

  @Roles(...CHANNEL_MANAGE_ROLES)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM, {
    paramName: 'deviceId',
  })
  @Serialize(DeviceChannelResponseDto)
  @Audit({
    action: 'device_channel.update',
    targetType: 'device_channel',
    entity: DeviceChannel,
  })
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

  @Roles(...CHANNEL_MANAGE_ROLES)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM, {
    paramName: 'deviceId',
  })
  @Audit({
    action: 'device_channel.delete',
    targetType: 'device_channel',
    entity: DeviceChannel,
  })
  @Delete(':id')
  remove(@Param('deviceId') deviceId: string, @Param('id') id: string) {
    return this.deviceChannelsService.remove(deviceId, id);
  }
}
