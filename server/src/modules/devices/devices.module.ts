import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { DeviceConfigModule } from '../device-config/device-config.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { Device } from './entities/device.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Device, ColdRoom]), DeviceConfigModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
