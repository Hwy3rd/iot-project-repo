import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { Audit } from '../../common/decorators/audit.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { AssignWarehouseStaffDto } from './dto/assign-warehouse-staff.dto';
import { WarehouseStaffResponseDto } from './dto/warehouse-staff-response.dto';
import { WarehouseStaff } from './entities/warehouse-staff.entity';
import { WarehouseStaffService } from './warehouse-staff.service';

const STAFF_AUDIT = {
  targetType: 'warehouse_staff',
  entity: WarehouseStaff,
  idParam: 'userId',
  lookup: { warehouseId: 'warehouseId', userId: 'userId' },
};

// Assigning people to warehouses is Admin-only (docs/RBAC.md §2.1); a
// Manager may only see who is assigned to a warehouse they're in.
@Controller('warehouses/:warehouseId/staff')
export class WarehouseStaffController {
  constructor(private readonly warehouseStaffService: WarehouseStaffService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @WarehouseScope(WarehouseScopeSource.WAREHOUSE_PARAM, {
    paramName: 'warehouseId',
  })
  @Serialize(WarehouseStaffResponseDto)
  @Get()
  findAll(
    @Param('warehouseId') warehouseId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.warehouseStaffService.findAll(warehouseId, query);
  }

  @Roles(UserRole.ADMIN)
  @Audit({ action: 'warehouse_staff.assign', ...STAFF_AUDIT })
  @Serialize(WarehouseStaffResponseDto)
  @Put(':userId')
  assign(
    @Param('warehouseId') warehouseId: string,
    @Param('userId') userId: string,
    @Body() dto: AssignWarehouseStaffDto,
  ) {
    return this.warehouseStaffService.assign(warehouseId, userId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Audit({ action: 'warehouse_staff.unassign', ...STAFF_AUDIT })
  @Delete(':userId')
  async unassign(
    @Param('warehouseId') warehouseId: string,
    @Param('userId') userId: string,
  ) {
    await this.warehouseStaffService.unassign(warehouseId, userId);
    return null;
  }
}
