import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CommandAction,
  CommandStatus,
} from '../../libs/constants/command.constant';
import { ChannelRole } from '../../libs/constants/device-channel.constant';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { CommandsService } from './commands.service';
import { Command } from './entities/command.entity';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
});

describe('CommandsService', () => {
  let service: CommandsService;
  let commandsRepository: MockRepository<Command>;
  let channelsRepository: MockRepository<DeviceChannel>;

  const dto = { channelId: 'c1', action: CommandAction.ON };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommandsService,
        {
          provide: getRepositoryToken(Command),
          useValue: createMockRepository<Command>(),
        },
        {
          provide: getRepositoryToken(DeviceChannel),
          useValue: createMockRepository<DeviceChannel>(),
        },
      ],
    }).compile();

    service = module.get<CommandsService>(CommandsService);
    commandsRepository = module.get(getRepositoryToken(Command));
    channelsRepository = module.get(getRepositoryToken(DeviceChannel));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('throws NotFoundException when the channel does not exist', async () => {
      channelsRepository.findOne!.mockResolvedValue(null);

      await expect(service.create(dto, 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the channel is a sensor', async () => {
      channelsRepository.findOne!.mockResolvedValue({
        id: 'c1',
        channelRole: ChannelRole.SENSOR,
      });

      await expect(service.create(dto, 'u1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates the command as pending', async () => {
      channelsRepository.findOne!.mockResolvedValue({
        id: 'c1',
        channelRole: ChannelRole.ACTUATOR,
      });
      commandsRepository.create!.mockImplementation((v: Partial<Command>) => v);
      commandsRepository.save!.mockImplementation((v: Partial<Command>) => ({
        id: 'cmd1',
        ...v,
      }));

      const result = await service.create(dto, 'u1');

      expect(commandsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: 'c1',
          issuedBy: 'u1',
          status: CommandStatus.PENDING,
        }),
      );
      expect(result).toMatchObject({
        id: 'cmd1',
        status: CommandStatus.PENDING,
      });
    });
  });

  describe('markSent', () => {
    it('throws ConflictException when the command is not pending', async () => {
      commandsRepository.findOne!.mockResolvedValue({
        id: 'cmd1',
        status: CommandStatus.SENT,
      });

      await expect(service.markSent('cmd1')).rejects.toThrow(ConflictException);
    });

    it('moves pending to sent', async () => {
      const command = { id: 'cmd1', status: CommandStatus.PENDING };
      commandsRepository.findOne!.mockResolvedValue(command);
      commandsRepository.save!.mockImplementation((v: Command) => v);

      const result = await service.markSent('cmd1');

      expect(result.status).toBe(CommandStatus.SENT);
    });
  });

  describe('acknowledge', () => {
    it('throws ConflictException when the command was not sent', async () => {
      commandsRepository.findOne!.mockResolvedValue({
        id: 'cmd1',
        status: CommandStatus.PENDING,
      });

      await expect(
        service.acknowledge('cmd1', { status: CommandStatus.DONE }),
      ).rejects.toThrow(ConflictException);
    });

    it('moves sent to done and sets ack_at', async () => {
      const command = {
        id: 'cmd1',
        status: CommandStatus.SENT,
        ackAt: null,
      };
      commandsRepository.findOne!.mockResolvedValue(command);
      commandsRepository.save!.mockImplementation((v: Command) => v);

      const result = await service.acknowledge('cmd1', {
        status: CommandStatus.DONE,
      });

      expect(result.status).toBe(CommandStatus.DONE);
      expect(result.ackAt).not.toBeNull();
    });
  });
});
