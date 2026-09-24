import { Controller, Get, Param, Query } from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { DeviceStatusHistoryResponseDto } from './dto/device-status-history-response.dto';
import { DeviceStatusHistoryService } from './device-status-history.service';

// Read-only: rows are written internally (see DeviceStatusHistoryService.record),
// never via a client request. Detailed device log — Admin/Manager/Technician
// only, per docs/rbac.md (Staff only gets "cảnh báo cơ bản").
@Controller('devices/:deviceId/status-history')
export class DeviceStatusHistoryController {
  constructor(
    private readonly deviceStatusHistoryService: DeviceStatusHistoryService,
  ) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN)
  @WarehouseScope(WarehouseScopeSource.DEVICE_PARAM, {
    paramName: 'deviceId',
  })
  @Serialize(DeviceStatusHistoryResponseDto)
  @Get()
  findAll(
    @Param('deviceId') deviceId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.deviceStatusHistoryService.findAllForDevice(deviceId, query);
  }
}
