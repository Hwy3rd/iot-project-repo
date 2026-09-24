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
import { Device } from './entities/device.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { ClaimCodeResponseDto } from './dto/claim-code-response.dto';
import { ClaimDeviceDto } from './dto/claim-device.dto';
import { CreateDeviceDto } from './dto/create-device.dto';
import { DeviceResponseDto } from './dto/device-response.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { DevicesService } from './devices.service';

const DEVICE_VIEW_ROLES = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.TECHNICIAN,
  UserRole.STAFF,
];
const DEVICE_TECHNICAL_ROLES = [UserRole.ADMIN, UserRole.TECHNICIAN];

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  // Registering brand-new, not-yet-assigned hardware: system-wide master
  // data, Admin only (a Technician has no warehouse to be scoped to yet).
  @Roles(UserRole.ADMIN)
  @Serialize(DeviceResponseDto)
  @Audit({ action: 'device.create', targetType: 'device', entity: Device })
  @Post()
  create(@Body() createDeviceDto: CreateDeviceDto) {
    return this.devicesService.create(createDeviceDto);
  }

  // No warehouse scope on the list endpoint: the service does not yet
  // filter results by the caller's assigned warehouses (see docs/rbac.md).
  @Roles(...DEVICE_VIEW_ROLES)
  @Serialize(DeviceResponseDto)
  @Get()
  findAll() {
    return this.devicesService.findAll();
  }

  @Roles(...DEVICE_VIEW_ROLES)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM, { requireShift: true })
  @Serialize(DeviceResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.devicesService.findOne(id);
  }

  @Roles(...DEVICE_TECHNICAL_ROLES)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM)
  @Serialize(DeviceResponseDto)
  @Audit({ action: 'device.update', targetType: 'device', entity: Device })
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDeviceDto: UpdateDeviceDto) {
    return this.devicesService.update(id, updateDeviceDto);
  }

  // Device must already be assigned to a cold room (i.e. already claimed
  // into a warehouse) for a Technician to (re-)provision it — an unassigned
  // device has no resolvable warehouse, so WarehouseScopeGuard denies
  // non-Admins there by construction.
  @Roles(...DEVICE_TECHNICAL_ROLES)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM)
  @Serialize(ClaimCodeResponseDto)
  @Audit({
    action: 'device.claim_code_generate',
    targetType: 'device',
    entity: Device,
  })
  @Post(':id/claim-code')
  generateClaimCode(@Param('id') id: string) {
    return this.devicesService.generateClaimCode(id);
  }

  // Scoped by the *destination* cold room (body.coldRoomId), not the
  // device's current room — the device may still be unassigned, which is
  // the whole point of claiming it.
  @Roles(...DEVICE_TECHNICAL_ROLES)
  @WarehouseScope(WarehouseScopeSource.COLD_ROOM_BODY, {
    paramName: 'coldRoomId',
  })
  @Serialize(DeviceResponseDto)
  @Audit({ action: 'device.claim', targetType: 'device', entity: Device })
  @Post(':id/claim')
  claim(@Param('id') id: string, @Body() claimDeviceDto: ClaimDeviceDto) {
    return this.devicesService.claim(id, claimDeviceDto);
  }

  @Roles(...DEVICE_TECHNICAL_ROLES)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM)
  @Serialize(DeviceResponseDto)
  @Post(':id/decommission')
  decommission(@Param('id') id: string) {
    return this.devicesService.decommission(id);
  }

  // Hard delete stays Admin-only, separate from (and rarer than) the
  // one-way decommission lifecycle step above.
  @Roles(UserRole.ADMIN)
  @Audit({ action: 'device.delete', targetType: 'device', entity: Device })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.devicesService.remove(id);
  }
}
