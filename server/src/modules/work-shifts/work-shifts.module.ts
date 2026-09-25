import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RealtimeModule } from '../realtime/realtime.module';
import { Shift } from '../shifts/entities/shift.entity';
import { User } from '../users/entities/user.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { WorkShift } from './entities/work-shift.entity';
import { WorkShiftsController } from './work-shifts.controller';
import { WorkShiftsService } from './work-shifts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkShift, Shift, User, WarehouseStaff]),
    // emitToUser() — check-in requests and reviews are pushed to the
    // Staff member and the warehouse's reviewers.
    RealtimeModule,
  ],
  controllers: [WorkShiftsController],
  providers: [WorkShiftsService],
})
export class WorkShiftsModule {}
