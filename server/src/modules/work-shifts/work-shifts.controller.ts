import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ScopedWarehouses,
  WarehouseListScope,
} from '../../common/decorators/warehouse-list-scope.decorator';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { Audit } from '../../common/decorators/audit.decorator';
import { GetUserId } from '../../common/decorators/get-user-id.decorator';
import { WorkShift } from './entities/work-shift.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { AttendanceResponseDto } from './dto/attendance-response.dto';
import { CheckInDto } from './dto/check-in.dto';
import { RejectWorkShiftDto } from './dto/reject-work-shift.dto';
import { WorkShiftResponseDto } from './dto/work-shift-response.dto';
import { QueryWorkShiftDto } from './dto/query-work-shift.dto';
import { WorkShiftsService } from './work-shifts.service';
import { BulkDeleteDto } from '../../common/bulk/bulk-delete';

@Controller('work-shifts')
export class WorkShiftsController {
  constructor(private readonly workShiftsService: WorkShiftsService) {}

  // The caller's own attendance state for the check-in screen. Any global
  // role may ask: it only reads the caller's rows and Staff assignments.
  @Serialize(AttendanceResponseDto)
  @Get('me')
  attendance(@GetUserId() userId: string) {
    return this.workShiftsService.attendance(userId);
  }

  // Staff of the warehouse in the body; the shift is picked by the server.
  @Roles(UserRole.STAFF)
  @WarehouseScope(WarehouseScopeSource.WAREHOUSE_BODY, {
    paramName: 'warehouseId',
  })
  @Serialize(WorkShiftResponseDto)
  @Audit({
    action: 'work_shift.check_in',
    targetType: 'work_shift',
    entity: WorkShift,
  })
  @Post('check-in')
  checkIn(@GetUserId() userId: string, @Body() dto: CheckInDto) {
    return this.workShiftsService.checkIn(userId, dto.warehouseId);
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
    action: 'work_shift.approve',
    targetType: 'work_shift',
    entity: WorkShift,
  })
  @HttpCode(HttpStatus.OK)
  @Post(':id/approve')
  approve(@Param('id') id: string, @GetUserId() reviewerId: string) {
    return this.workShiftsService.approve(id, reviewerId);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @WarehouseScope(WarehouseScopeSource.WORK_SHIFT_PARAM)
  @Serialize(WorkShiftResponseDto)
  @Audit({
    action: 'work_shift.reject',
    targetType: 'work_shift',
    entity: WorkShift,
  })
  @HttpCode(HttpStatus.OK)
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @GetUserId() reviewerId: string,
    @Body() dto: RejectWorkShiftDto,
  ) {
    return this.workShiftsService.reject(id, reviewerId, dto.reason);
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
  @HttpCode(HttpStatus.OK)
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

  // Bulk counterpart of DELETE /work-shifts/:id (same roles; per-row
  // warehouse check in the service).
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @WarehouseListScope()
  @Audit({
    action: 'work_shift.delete',
    targetType: 'work_shift',
    entity: WorkShift,
    bulk: true,
  })
  @HttpCode(HttpStatus.OK)
  @Post('bulk-delete')
  bulkRemove(
    @Body() dto: BulkDeleteDto,
    @ScopedWarehouses() access: WarehouseAccess,
  ) {
    return this.workShiftsService.bulkRemove(dto.ids, access);
  }
}
