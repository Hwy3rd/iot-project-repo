import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { WarehouseStaff } from './entities/warehouse-staff.entity';
import { WarehousesService } from './warehouses.service';
import { WarehousesController } from './warehouses.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Warehouse, WarehouseStaff])],
  controllers: [WarehousesController],
  providers: [WarehousesService],
})
export class WarehousesModule {}
