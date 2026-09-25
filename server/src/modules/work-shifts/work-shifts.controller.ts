import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ScopedWarehouses,
  WarehouseListScope,
} from '../../common/decorators/warehouse-list-scope.decorator';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { Audit } from '../../common/decorators/audit.decorator';
import { WorkShift } from './entities/work-shift.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { CreateWorkShiftDto } from './dto/create-work-shift.dto';
import { UpdateWorkShiftDto } from './dto/update-work-shift.dto';
import { WorkShiftResponseDto } from './dto/work-shift-response.dto';
import { QueryWorkShiftDto } from './dto/query-work-shift.dto';
import { WorkShiftsService } from './work-shifts.service';

@Controller('work-shifts')
export class WorkShiftsController {
  constructor(private readonly workShiftsService: WorkShiftsService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @WarehouseScope(WarehouseScopeSource.WAREHOUSE_BODY, {
    paramName: 'warehouseId',
  })
  @Serialize(WorkShiftResponseDto)
  @Audit({
    action: 'work_shift.create',
    targetType: 'work_shift',
    entity: WorkShift,
  })
  @Post()
  create(@Body() createWorkShiftDto: CreateWorkShiftDto) {
    return this.workShiftsService.create(createWorkShiftDto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Serialize(WorkShiftResponseDto)
  @WarehouseListScope()
  @Get()
  findAll(
    @ScopedWarehouses() access: WarehouseAccess,
    @Query() query: QueryWorkShiftDto,
  ) {
    return this.workShiftsService.findAll(access, query);
  }

  // Staff: only their own shift, same rule as the list endpoint.
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @WarehouseScope(WarehouseScopeSource.WORK_SHIFT_PARAM, { ownStaffOnly: true })
  @Serialize(WorkShiftResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workShiftsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @WarehouseScope(WarehouseScopeSource.WORK_SHIFT_PARAM)
  @Serialize(WorkShiftResponseDto)
  @Audit({
    action: 'work_shift.update',
    targetType: 'work_shift',
    entity: WorkShift,
  })
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateWorkShiftDto: UpdateWorkShiftDto,
  ) {
    return this.workShiftsService.update(id, updateWorkShiftDto);
  }

  @Roles(UserRole.STAFF)
  @WarehouseScope(WarehouseScopeSource.WORK_SHIFT_PARAM, {
    ownStaffOnly: true,
  })
  @Serialize(WorkShiftResponseDto)
  @Audit({
    action: 'work_shift.check_in',
    targetType: 'work_shift',
    entity: WorkShift,
  })
  @Post(':id/check-in')
  checkIn(@Param('id') id: string) {
    return this.workShiftsService.checkIn(id);
  }

  @Roles(UserRole.STAFF)
  @WarehouseScope(WarehouseScopeSource.WORK_SHIFT_PARAM, {
    ownStaffOnly: true,
  })
  @Serialize(WorkShiftResponseDto)
  @Audit({
    action: 'work_shift.check_out',
    targetType: 'work_shift',
    entity: WorkShift,
  })
  @Post(':id/check-out')
  checkOut(@Param('id') id: string) {
    return this.workShiftsService.checkOut(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @WarehouseScope(WarehouseScopeSource.WORK_SHIFT_PARAM)
  @Audit({
    action: 'work_shift.delete',
    targetType: 'work_shift',
    entity: WorkShift,
  })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workShiftsService.remove(id);
  }
}
