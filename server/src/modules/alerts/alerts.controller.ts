import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { AlertsService } from './alerts.service';
import { AcknowledgeAlertDto } from './dto/acknowledge-alert.dto';
import { AlertResponseDto } from './dto/alert-response.dto';
import { QueryAlertDto } from './dto/query-alert.dto';
import { ResolveAlertDto } from './dto/resolve-alert.dto';

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

  // No warehouse scope on the list endpoint: the service does not yet
  // filter results by the caller's assigned warehouses (see docs/rbac.md).
  @Roles(...VIEW_ROLES)
  @Serialize(AlertResponseDto)
  @Get()
  findAll(@Query() query: QueryAlertDto) {
    return this.alertsService.findAll(query);
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
  acknowledge(
    @Param('id') id: string,
    @Body() acknowledgeAlertDto: AcknowledgeAlertDto,
  ) {
    return this.alertsService.acknowledge(id, acknowledgeAlertDto);
  }

  // Resolve is a business decision, not Staff's call (see docs/rbac.md).
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.TECHNICIAN)
  @WarehouseScope(WarehouseScopeSource.ALERT_PARAM)
  @Serialize(AlertResponseDto)
  @Post(':id/resolve')
  resolve(@Param('id') id: string, @Body() resolveAlertDto: ResolveAlertDto) {
    return this.alertsService.resolveManual(id, resolveAlertDto);
  }
}
