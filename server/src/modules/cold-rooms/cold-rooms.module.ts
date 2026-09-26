import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from '../alerts/entities/alert.entity';
import { BatchesModule } from '../batches/batches.module';
import { Device } from '../devices/entities/device.entity';
import { TELEMETRY_MODELS } from '../telemetry/telemetry.models';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { ColdRoomStatusService } from './cold-room-status.service';
import { ColdRoom } from './entities/cold-room.entity';
import { ColdRoomsService } from './cold-rooms.service';
import { ColdRoomsController } from './cold-rooms.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ColdRoom, Warehouse, Device, Alert]),
    // Read-only use of the telemetry collection (latest reading per room);
    // registered here rather than importing TelemetryModule, which pulls in
    // AlertsModule and the ingest side.
    MongooseModule.forFeature(TELEMETRY_MODELS),
    BatchesModule,
  ],
  controllers: [ColdRoomsController],
  providers: [ColdRoomsService, ColdRoomStatusService],
  // The chatbot's room status/health tools read the same live overview.
  exports: [ColdRoomStatusService],
})
export class ColdRoomsModule {}
