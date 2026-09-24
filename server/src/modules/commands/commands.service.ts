import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CommandStatus } from '../../libs/constants/command.constant';
import { ChannelRole } from '../../libs/constants/device-channel.constant';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
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
  ) {}

  // issuedBy: the authenticated user, or null for a command raised by an
  // automated rule (e.g. an alert-triggered actuator) — never taken from
  // the request body.
  async create(createCommandDto: CreateCommandDto, issuedBy: string | null) {
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

    const command = this.commandsRepository.create({
      channelId: createCommandDto.channelId,
      issuedBy,
      action: createCommandDto.action,
      payload: createCommandDto.payload ?? null,
      status: CommandStatus.PENDING,
    });
    return this.commandsRepository.save(command);
  }

  // access omitted = unfiltered (internal callers); see WarehouseAccess.
  async findAll(
    access?: WarehouseAccess,
    query: PaginationQueryDto = {},
  ): Promise<Paginated<Command>> {
    const ids = access?.warehouseIds;
    if (ids?.length === 0) return Paginated.empty(query);
    const pagination = resolvePagination(query);
    const [items, total] = await this.commandsRepository.findAndCount({
      where: ids
        ? { channel: { device: { coldRoom: { warehouseId: In(ids) } } } }
        : {},
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
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
}
