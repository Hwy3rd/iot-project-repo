import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shift } from '../shifts/entities/shift.entity';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { WorkShift } from './entities/work-shift.entity';
import { WorkShiftsController } from './work-shifts.controller';
import { WorkShiftsService } from './work-shifts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkShift,
      Shift,
      Warehouse,
      User,
      WarehouseStaff,
    ]),
  ],
  controllers: [WorkShiftsController],
  providers: [WorkShiftsService],
})
export class WorkShiftsModule {}
