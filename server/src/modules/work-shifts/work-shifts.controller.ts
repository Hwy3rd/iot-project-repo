import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { WarehouseScope } from '../../common/decorators/warehouse-scope.decorator';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { CreateWorkShiftDto } from './dto/create-work-shift.dto';
import { UpdateWorkShiftDto } from './dto/update-work-shift.dto';
import { WorkShiftResponseDto } from './dto/work-shift-response.dto';
import { WorkShiftsService } from './work-shifts.service';

@Controller('work-shifts')
export class WorkShiftsController {
  constructor(private readonly workShiftsService: WorkShiftsService) {}

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @WarehouseScope(WarehouseScopeSource.WAREHOUSE_BODY, {
    paramName: 'warehouseId',
  })
  @Serialize(WorkShiftResponseDto)
  @Post()
  create(@Body() createWorkShiftDto: CreateWorkShiftDto) {
    return this.workShiftsService.create(createWorkShiftDto);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @Serialize(WorkShiftResponseDto)
  @Get()
  findAll() {
    return this.workShiftsService.findAll();
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @WarehouseScope(WarehouseScopeSource.WORK_SHIFT_PARAM)
  @Serialize(WorkShiftResponseDto)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.workShiftsService.findOne(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @WarehouseScope(WarehouseScopeSource.WORK_SHIFT_PARAM)
  @Serialize(WorkShiftResponseDto)
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
  @Post(':id/check-in')
  checkIn(@Param('id') id: string) {
    return this.workShiftsService.checkIn(id);
  }

  @Roles(UserRole.STAFF)
  @WarehouseScope(WarehouseScopeSource.WORK_SHIFT_PARAM, {
    ownStaffOnly: true,
  })
  @Serialize(WorkShiftResponseDto)
  @Post(':id/check-out')
  checkOut(@Param('id') id: string) {
    return this.workShiftsService.checkOut(id);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @WarehouseScope(WarehouseScopeSource.WORK_SHIFT_PARAM)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workShiftsService.remove(id);
  }
}
