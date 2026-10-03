import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { User } from '../users/entities/user.entity';
import { CommandAckService } from './command-ack.service';
import { CommandDispatcherService } from './command-dispatcher.service';
import { CommandsController } from './commands.controller';
import { CommandsService } from './commands.service';
import { Command } from './entities/command.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Command, DeviceChannel, User])],
  controllers: [CommandsController],
  providers: [CommandsService, CommandDispatcherService, CommandAckService],
})
export class CommandsModule {}
