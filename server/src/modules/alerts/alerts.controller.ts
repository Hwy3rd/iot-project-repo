import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { GetUserId } from '../../common/decorators/get-user-id.decorator';
import {
  ScopedWarehouses,
  WarehouseListScope,
} from '../../common/decorators/warehouse-list-scope.decorator';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { AlertsService } from './alerts.service';
import { AlertResponseDto } from './dto/alert-response.dto';
import { QueryAlertDto } from './dto/query-alert.dto';

const VIEW_ROLES = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.TECHNICIAN,
  UserRole.STAFF,
];

// No POST / here on purpose — alerts are raised internally by whatever
// detects an incident (see AlertsService.raise), never by a client request.
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Roles(...VIEW_ROLES)
  @Serialize(AlertResponseDto)
  @WarehouseListScope()
  @Get()
  findAll(
    @Query() query: QueryAlertDto,
    @ScopedWarehouses() access: WarehouseAccess,
  ) {
    return this.alertsService.findAll(query, access);
  }

  @Roles(...VIEW_ROLES)
  @WarehouseScope(WarehouseScopeSource.ALERT_PARAM)
  @Serialize(AlertResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.alertsService.findOne(id);
  }

  @Roles(...VIEW_ROLES)
  @WarehouseScope(WarehouseScopeSource.ALERT_PARAM, { requireShift: true })
  @Serialize(AlertResponseDto)
  @Post(':id/acknowledge')
  acknowledge(@Param('id') id: string, @GetUserId() userId: string) {
    return this.alertsService.acknowledge(id, userId);
  }

  // Resolve is a business decision, not Staff's call (see docs/rbac.md).
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN)
  @WarehouseScope(WarehouseScopeSource.ALERT_PARAM)
  @Serialize(AlertResponseDto)
  @Post(':id/resolve')
  resolve(@Param('id') id: string, @GetUserId() userId: string) {
    return this.alertsService.resolveManual(id, userId);
  }
}
