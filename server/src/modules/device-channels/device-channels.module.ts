import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../devices/entities/device.entity';
import { DeviceChannelsController } from './device-channels.controller';
import { DeviceChannelsService } from './device-channels.service';
import { DeviceChannel } from './entities/device-channel.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceChannel, Device])],
  controllers: [DeviceChannelsController],
  providers: [DeviceChannelsService],
})
export class DeviceChannelsModule {}
