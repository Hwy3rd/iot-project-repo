import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommandStatus } from '../../libs/constants/command.constant';
import { ChannelRole } from '../../libs/constants/device-channel.constant';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { User } from '../users/entities/user.entity';
import { AcknowledgeCommandDto } from './dto/acknowledge-command.dto';
import { CreateCommandDto } from './dto/create-command.dto';
import { Command } from './entities/command.entity';

@Injectable()
export class CommandsService {
  constructor(
    @InjectRepository(Command)
    private readonly commandsRepository: Repository<Command>,
    @InjectRepository(DeviceChannel)
    private readonly channelsRepository: Repository<DeviceChannel>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async create(createCommandDto: CreateCommandDto) {
    const channel = await this.channelsRepository.findOne({
      where: { id: createCommandDto.channelId },
    });
    if (!channel) {
      throw new NotFoundException(
        `Channel ${createCommandDto.channelId} not found`,
      );
    }
    if (channel.channelRole !== ChannelRole.ACTUATOR) {
      throw new ConflictException(
        `Channel ${createCommandDto.channelId} is a sensor and cannot receive commands`,
      );
    }

    if (createCommandDto.issuedBy) {
      const issuer = await this.usersRepository.findOne({
        where: { id: createCommandDto.issuedBy },
      });
      if (!issuer) {
        throw new NotFoundException(
          `User ${createCommandDto.issuedBy} not found`,
        );
      }
    }

    const command = this.commandsRepository.create({
      channelId: createCommandDto.channelId,
      issuedBy: createCommandDto.issuedBy ?? null,
      action: createCommandDto.action,
      payload: createCommandDto.payload ?? null,
      status: CommandStatus.PENDING,
    });
    return this.commandsRepository.save(command);
  }

  findAll() {
    return this.commandsRepository.find();
  }

  async findOne(id: string) {
    const command = await this.commandsRepository.findOne({ where: { id } });
    if (!command) {
      throw new NotFoundException(`Command ${id} not found`);
    }
    return command;
  }

  async markSent(id: string) {
    const command = await this.findOne(id);
    if (command.status !== CommandStatus.PENDING) {
      throw new ConflictException(
        `Command ${id} cannot be marked sent from status ${command.status}`,
      );
    }
    command.status = CommandStatus.SENT;
    return this.commandsRepository.save(command);
  }

  async acknowledge(id: string, acknowledgeCommandDto: AcknowledgeCommandDto) {
    const command = await this.findOne(id);
    if (command.status !== CommandStatus.SENT) {
      throw new ConflictException(
        `Command ${id} cannot be acknowledged from status ${command.status}`,
      );
    }
    command.status = acknowledgeCommandDto.status;
    command.ackAt = new Date();
    return this.commandsRepository.save(command);
  }

  async remove(id: string) {
    const result = await this.commandsRepository.delete(id);
    if (!result.affected) {
      throw new NotFoundException(`Command ${id} not found`);
    }
  }
}
