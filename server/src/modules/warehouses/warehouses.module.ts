import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UploadFilesModule } from '../upload-files/upload-files.module';
import { Warehouse } from './entities/warehouse.entity';
import { WarehouseStaff } from './entities/warehouse-staff.entity';
import { WarehousesService } from './warehouses.service';
import { User } from '../users/entities/user.entity';
import { WarehouseStaffController } from './warehouse-staff.controller';
import { WarehouseStaffService } from './warehouse-staff.service';
import { WarehousesController } from './warehouses.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Warehouse, WarehouseStaff, User]),
    UploadFilesModule,
  ],
  controllers: [WarehousesController, WarehouseStaffController],
  providers: [WarehousesService, WarehouseStaffService],
})
export class WarehousesModule {}
