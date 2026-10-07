import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { Device } from '../devices/entities/device.entity';
import { DeviceConfigService } from './device-config.service';

// Pushes each room's alarm thresholds to its devices over MQTT. Imported by
// the modules whose mutations change what a device should be running.
@Module({
  imports: [TypeOrmModule.forFeature([Device, ColdRoom])],
  providers: [DeviceConfigService],
  exports: [DeviceConfigService],
})
export class DeviceConfigModule {}
