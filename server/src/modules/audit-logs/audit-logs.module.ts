import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { AuditLog } from './entities/audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, WarehouseStaff])],
  controllers: [AuditLogsController],
  providers: [AuditLogsService],
  // Exported so other modules can append entries internally — there is no
  // HTTP write route.
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
