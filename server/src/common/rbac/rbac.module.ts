import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from '../../modules/alerts/entities/alert.entity';
import { Batch } from '../../modules/batches/entities/batch.entity';
import { ColdRoom } from '../../modules/cold-rooms/entities/cold-room.entity';
import { Command } from '../../modules/commands/entities/command.entity';
import { DeviceChannel } from '../../modules/device-channels/entities/device-channel.entity';
import { Device } from '../../modules/devices/entities/device.entity';
import { WarehouseStaff } from '../../modules/warehouses/entities/warehouse-staff.entity';
import { WorkShift } from '../../modules/work-shifts/entities/work-shift.entity';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { WarehouseScopeGuard } from '../guards/warehouse-scope.guard';

// Wires the global request-authorization pipeline described in docs/rbac.md,
// applied in this order to every route (opt out with @Public()/@Roles()/
// @WarehouseScope() as appropriate):
//   1. JwtAuthGuard        — must be authenticated
//   2. RolesGuard          — caller's role must be in @Roles(...)
//   3. WarehouseScopeGuard — caller must be assigned to the resolved
//                            warehouse (@WarehouseScope(...)), and, for
//                            Staff, checked into an active work shift there
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WarehouseStaff,
      ColdRoom,
      Device,
      Batch,
      Alert,
      Command,
      DeviceChannel,
      WorkShift,
    ]),
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: WarehouseScopeGuard },
  ],
})
export class RbacModule {}
