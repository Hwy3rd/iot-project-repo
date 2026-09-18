import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadFilesModule } from '../upload-files/upload-files.module';
import { Warehouse } from './entities/warehouse.entity';
import { WarehouseStaff } from './entities/warehouse-staff.entity';
import { WarehousesService } from './warehouses.service';
import { WarehousesController } from './warehouses.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Warehouse, WarehouseStaff]),
    UploadFilesModule,
  ],
  controllers: [WarehousesController],
  providers: [WarehousesService],
})
export class WarehousesModule {}
