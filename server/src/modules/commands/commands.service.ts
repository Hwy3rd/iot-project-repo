import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import {
  createdBetween,
  narrowWarehouseIds,
} from '../../common/query/find-filters';
import { QueryCommandDto } from './dto/query-command.dto';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import {
  COMMAND_TTL_MS,
  CommandStatus,
  OPEN_COMMAND_STATUSES,
} from '../../libs/constants/command.constant';
import { ChannelRole } from '../../libs/constants/device-channel.constant';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { CommandDispatcherService } from './command-dispatcher.service';
import { CreateCommandDto } from './dto/create-command.dto';
import { Command } from './entities/command.entity';

@Injectable()
export class CommandsService {
  constructor(
    @InjectRepository(Command)
    private readonly commandsRepository: Repository<Command>,
    private readonly dispatcher: CommandDispatcherService,
  ) {}

  // issuedBy: the authenticated user, or null for a command raised by an
  // automated rule (e.g. an alert-triggered actuator) — never taken from
  // the request body.
  async create(createCommandDto: CreateCommandDto, issuedBy: string | null) {
    const { channelId } = createCommandDto;
    const command = await this.commandsRepository.manager.transaction(
      async (manager) => {
        // Row lock on the channel serializes concurrent commands to it, so
        // exactly one of them ends up open — the latest one.
        const channel = await manager.findOne(DeviceChannel, {
          where: { id: channelId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!channel) {
          throw new NotFoundException(`Channel ${channelId} not found`);
        }
        if (channel.channelRole !== ChannelRole.ACTUATOR) {
          throw new ConflictException(
            `Channel ${channelId} is a sensor and cannot receive commands`,
          );
        }

        // A newer intent for the channel replaces whatever is still in
        // flight: re-publishing an older `on` after a newer `off` would
        // leave the actuator in the wrong state.
        await manager.update(
          Command,
          { channelId, status: In([...OPEN_COMMAND_STATUSES]) },
          { status: CommandStatus.SUPERSEDED },
        );
        return manager.save(
          manager.create(Command, {
            channelId,
            issuedBy,
            action: createCommandDto.action,
            payload: createCommandDto.payload ?? null,
            status: CommandStatus.PENDING,
            attempts: 0,
            expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
          }),
        );
      },
    );

    // Outside the transaction: the row must be committed before the device
    // can ack it. A failed publish isn't an error for the caller — the
    // command stays pending and CommandRetryProcessor sends it.
    await this.dispatcher.dispatch(command);
    return this.findOne(command.id);
  }

  // access omitted = unfiltered (internal callers); see WarehouseAccess.
  async findAll(
    access?: WarehouseAccess,
    query: QueryCommandDto = {},
  ): Promise<Paginated<Command>> {
    const ids = narrowWarehouseIds(access?.warehouseIds, query.warehouseId);
    if (ids?.length === 0) return Paginated.empty(query);
    const where: FindOptionsWhere<Command> = {};
    if (ids || query.deviceId) {
      where.channel = {
        ...(query.deviceId && { deviceId: query.deviceId }),
        ...(ids && { device: { coldRoom: { warehouseId: In(ids) } } }),
      };
    }
    if (query.status) where.status = query.status;
    if (query.action) where.action = query.action;
    if (query.channelId) where.channelId = query.channelId;
    if (query.issuedBy) where.issuedBy = query.issuedBy;
    const createdAt = createdBetween(query.createdFrom, query.createdTo);
    if (createdAt) where.createdAt = createdAt;
    const pagination = resolvePagination(query);
    const [items, total] = await this.commandsRepository.findAndCount({
      where,
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
}
