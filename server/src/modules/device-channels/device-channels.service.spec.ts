import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ChannelRole,
  ChannelType,
} from '../../libs/constants/device-channel.constant';
import { DeviceChannelsService } from './device-channels.service';
import { DeviceChannel } from './entities/device-channel.entity';
import { Device } from '../devices/entities/device.entity';

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

describe('DeviceChannelsService', () => {
  let service: DeviceChannelsService;
  let channelsRepository: MockRepository<DeviceChannel>;
  let devicesRepository: MockRepository<Device>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceChannelsService,
        {
          provide: getRepositoryToken(DeviceChannel),
          useValue: createMockRepository<DeviceChannel>(),
        },
        {
          provide: getRepositoryToken(Device),
          useValue: createMockRepository<Device>(),
        },
      ],
    }).compile();

    service = module.get<DeviceChannelsService>(DeviceChannelsService);
    channelsRepository = module.get(getRepositoryToken(DeviceChannel));
    devicesRepository = module.get(getRepositoryToken(Device));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('throws NotFoundException when the device does not exist', async () => {
      devicesRepository.findOne!.mockResolvedValue(null);

      await expect(
        service.create('missing-device', {
          channelType: ChannelType.FAN_MOTOR,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('derives channelRole from channelType', async () => {
      devicesRepository.findOne!.mockResolvedValue({ id: 'd1' });
      channelsRepository.create!.mockImplementation(
        (v: Partial<DeviceChannel>) => v,
      );
      channelsRepository.save!.mockImplementation(
        (v: Partial<DeviceChannel>) => ({ id: 'c1', ...v }),
      );

      const result = await service.create('d1', {
        channelType: ChannelType.FAN_MOTOR,
      });

      expect(channelsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'd1',
          channelType: ChannelType.FAN_MOTOR,
          channelRole: ChannelRole.ACTUATOR,
        }),
      );
      expect(result).toMatchObject({ channelRole: ChannelRole.ACTUATOR });
    });
  });

  describe('addDefaults', () => {
    it('adds the missing default channels and returns the full list', async () => {
      devicesRepository.findOne!.mockResolvedValue({ id: 'd1' });
      const manager = {
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((_e: unknown, v: unknown) => v),
        save: jest.fn((_e: unknown, v: unknown) => Promise.resolve(v)),
      };
      (channelsRepository as { manager?: unknown }).manager = manager;
      channelsRepository.find!.mockResolvedValue([{ id: 'c1' }]);

      await expect(service.addDefaults('d1')).resolves.toEqual([{ id: 'c1' }]);
      expect(manager.save).toHaveBeenCalledWith(
        DeviceChannel,
        expect.arrayContaining([
          expect.objectContaining({ deviceId: 'd1', channelType: 'fan_motor' }),
        ]),
      );
    });

    it('throws NotFoundException for an unknown device', async () => {
      devicesRepository.findOne!.mockResolvedValue(null);

      await expect(service.addDefaults('d1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllForDevice', () => {
    it('throws NotFoundException when the device does not exist', async () => {
      devicesRepository.findOne!.mockResolvedValue(null);

      await expect(service.findAllForDevice('missing-device')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the channel does not exist on the device', async () => {
      channelsRepository.findOne!.mockResolvedValue(null);

      await expect(service.findOne('d1', 'c1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      channelsRepository.delete!.mockResolvedValue({ affected: 0 });

      await expect(service.remove('d1', 'missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes the channel', async () => {
      channelsRepository.delete!.mockResolvedValue({ affected: 1 });

      await expect(service.remove('d1', 'c1')).resolves.toBeUndefined();
    });
  });
});
