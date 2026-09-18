import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { User } from '../users/entities/user.entity';
import { CommandsController } from './commands.controller';
import { CommandsService } from './commands.service';
import { Command } from './entities/command.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Command, DeviceChannel, User])],
  controllers: [CommandsController],
  providers: [CommandsService],
})
export class CommandsModule {}
