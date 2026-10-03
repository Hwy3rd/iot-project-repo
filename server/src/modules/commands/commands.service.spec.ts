import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  COMMAND_TTL_MS,
  CommandAction,
  CommandStatus,
} from '../../libs/constants/command.constant';
import { UserRole } from '../../libs/constants/user.constant';
import { ChannelRole } from '../../libs/constants/device-channel.constant';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { CommandDispatcherService } from './command-dispatcher.service';
import { CommandsService } from './commands.service';
import { Command } from './entities/command.entity';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
});

// The EntityManager handed to the transaction callback in create().
const createMockManager = () => ({
  findOne: jest.fn(),
  update: jest.fn().mockResolvedValue({ affected: 0 }),
  create: jest.fn((_entity: unknown, v: Partial<Command>) => v),
  save: jest.fn((v: Partial<Command>) => Promise.resolve({ id: 'cmd1', ...v })),
});

describe('CommandsService', () => {
  let service: CommandsService;
  let commandsRepository: Omit<MockRepository<Command>, 'manager'> & {
    manager?: unknown;
  };
  let manager: ReturnType<typeof createMockManager>;
  const dispatcher = { dispatch: jest.fn() };

  const dto = { channelId: 'c1', action: CommandAction.ON };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommandsService,
        {
          provide: getRepositoryToken(Command),
          useValue: createMockRepository<Command>(),
        },
        { provide: CommandDispatcherService, useValue: dispatcher },
      ],
    }).compile();

    service = module.get<CommandsService>(CommandsService);
    commandsRepository = module.get(getRepositoryToken(Command));
    manager = createMockManager();
    commandsRepository.manager = {
      transaction: (cb: (m: typeof manager) => unknown) => cb(manager),
    };
    commandsRepository.findOne!.mockResolvedValue({
      id: 'cmd1',
      status: CommandStatus.SENT,
    });
    dispatcher.dispatch.mockReset().mockResolvedValue(true);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const actuator = { id: 'c1', channelRole: ChannelRole.ACTUATOR };

    it('throws NotFoundException when the channel does not exist', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(service.create(dto, 'u1')).rejects.toThrow(
        NotFoundException,
      );
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the channel is a sensor', async () => {
      manager.findOne.mockResolvedValue({
        id: 'c1',
        channelRole: ChannelRole.SENSOR,
      });

      await expect(service.create(dto, 'u1')).rejects.toThrow(
        ConflictException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('locks the channel and supersedes its open commands first', async () => {
      manager.findOne.mockResolvedValue(actuator);

      await service.create(dto, 'u1');

      expect(manager.findOne).toHaveBeenCalledWith(
        DeviceChannel,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.update).toHaveBeenCalledWith(
        Command,
        {
          channelId: 'c1',
          status: In([CommandStatus.PENDING, CommandStatus.SENT]),
        },
        { status: CommandStatus.SUPERSEDED },
      );
      expect(manager.update.mock.invocationCallOrder[0]).toBeLessThan(
        manager.save.mock.invocationCallOrder[0],
      );
    });

    it('saves the command as pending with an expiry, then dispatches it', async () => {
      manager.findOne.mockResolvedValue(actuator);
      const before = Date.now();

      const result = await service.create(dto, 'u1');

      const saved = manager.save.mock.calls[0][0] as Command;
      expect(saved).toMatchObject({
        channelId: 'c1',
        issuedBy: 'u1',
        status: CommandStatus.PENDING,
        attempts: 0,
      });
      expect(saved.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + COMMAND_TTL_MS,
      );
      expect(dispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'cmd1' }),
      );
      // Returned as re-read after the dispatch, i.e. with its new status.
      expect(result).toMatchObject({ id: 'cmd1', status: CommandStatus.SENT });
    });
  });

  describe('findAll', () => {
    it('merges deviceId and warehouse scope into one channel condition', async () => {
      commandsRepository.findAndCount!.mockResolvedValue([[], 0]);

      await service.findAll(
        {
          userId: 'u1',
          role: UserRole.MANAGER,
          warehouseIds: ['w1', 'w2'],
          staffWarehouseIds: [],
        },
        { deviceId: 'd1', warehouseId: 'w2' },
      );

      expect(commandsRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            channel: {
              deviceId: 'd1',
              device: { coldRoom: { warehouseId: In(['w2']) } },
            },
          },
        }),
      );
    });
  });
});
