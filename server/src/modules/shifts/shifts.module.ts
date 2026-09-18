import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shift } from './entities/shift.entity';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Shift])],
  controllers: [ShiftsController],
  providers: [ShiftsService],
})
export class ShiftsModule {}
