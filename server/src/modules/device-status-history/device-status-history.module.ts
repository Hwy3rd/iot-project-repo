import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../devices/entities/device.entity';
import { DeviceStatusHistoryController } from './device-status-history.controller';
import { DeviceStatusHistoryService } from './device-status-history.service';
import { DeviceStatusHistory } from './entities/device-status-history.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceStatusHistory, Device])],
  controllers: [DeviceStatusHistoryController],
  providers: [DeviceStatusHistoryService],
  exports: [DeviceStatusHistoryService],
})
export class DeviceStatusHistoryModule {}
