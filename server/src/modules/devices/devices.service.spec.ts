import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsNull, Like, QueryFailedError, Repository } from 'typeorm';
import {
  DeviceStatus,
  DeviceStatusChangeTrigger,
} from '../../libs/constants/device.constant';
import { DeviceStatusHistory } from '../device-status-history/entities/device-status-history.entity';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { DevicesService } from './devices.service';
import {
  CHANNEL_TYPE_ROLE,
  DEVICE_DEFAULT_CHANNELS,
} from '../../libs/constants/device-channel.constant';
import { DeviceChannel } from '../device-channels/entities/device-channel.entity';
import { Device } from './entities/device.entity';

jest.mock('bcryptjs');

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  softDelete: jest.fn(),
});

// The EntityManager a lifecycle step's transaction runs with: saves echo
// back what they were given, creates build a plain object.
const createMockManager = () => ({
  // No channels declared yet (the claim then adds the board's defaults).
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn((_entity: unknown, value: unknown) => Promise.resolve(value)),
  create: jest.fn((_entity: unknown, value: unknown) => value),
});

describe('DevicesService', () => {
  let service: DevicesService;
  let devicesRepository: MockRepository<Device>;
  let coldRoomsRepository: MockRepository<ColdRoom>;
  let manager: ReturnType<typeof createMockManager>;

  beforeEach(async () => {
    manager = createMockManager();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevicesService,
        {
          provide: getRepositoryToken(Device),
          useValue: {
            ...createMockRepository<Device>(),
            manager: {
              transaction: jest.fn(
                (work: (m: ReturnType<typeof createMockManager>) => unknown) =>
                  work(manager),
              ),
            },
          },
        },
        {
          provide: getRepositoryToken(ColdRoom),
          useValue: createMockRepository<ColdRoom>(),
        },
      ],
    }).compile();

    service = module.get<DevicesService>(DevicesService);
    devicesRepository = module.get(getRepositoryToken(Device));
    coldRoomsRepository = module.get(getRepositoryToken(ColdRoom));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('converts a duplicate unique_id into ConflictException', async () => {
      devicesRepository.create!.mockReturnValue({ uniqueId: 'esp32-1' });
      devicesRepository.save!.mockRejectedValue(
        new QueryFailedError('INSERT ...', [], {
          name: 'Error',
          message: 'Duplicate entry',
          code: 'ER_DUP_ENTRY',
        } as unknown as Error),
      );

      await expect(service.create({ uniqueId: 'esp32-1' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates the device as registered', async () => {
      devicesRepository.create!.mockImplementation((v: Partial<Device>) => v);
      devicesRepository.save!.mockImplementation((v: Partial<Device>) => ({
        id: 'd1',
        status: DeviceStatus.REGISTERED,
        ...v,
      }));

      const result = await service.create({ uniqueId: 'esp32-1' });

      expect(devicesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ uniqueId: 'esp32-1', firmwareVersion: null }),
      );
      expect(result).toMatchObject({
        id: 'd1',
        status: DeviceStatus.REGISTERED,
      });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the device does not exist', async () => {
      devicesRepository.findOne!.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('generateClaimCode', () => {
    it('throws ConflictException when the device is already active', async () => {
      devicesRepository.findOne!.mockResolvedValue({
        id: 'd1',
        status: DeviceStatus.ACTIVE,
      });

      await expect(service.generateClaimCode('d1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('sets a hashed claim code, expiry, and moves to provisioned', async () => {
      const device = { id: 'd1', status: DeviceStatus.REGISTERED };
      devicesRepository.findOne!.mockResolvedValue(device);
      devicesRepository.save!.mockImplementation((v: Device) => v);

      const result = await service.generateClaimCode('d1', 'u1');

      expect(device.status).toBe(DeviceStatus.PROVISIONED);
      expect(result.claimCode).toMatch(/^\d{6}$/);
      expect(result.claimCodeExpiresAt).toBeInstanceOf(Date);
      expect(manager.save).toHaveBeenLastCalledWith(DeviceStatusHistory, {
        deviceId: 'd1',
        oldStatus: DeviceStatus.REGISTERED,
        newStatus: DeviceStatus.PROVISIONED,
        trigger: DeviceStatusChangeTrigger.MANUAL,
        changedBy: 'u1',
      });
    });

    it('records no history when re-generating on a provisioned device', async () => {
      devicesRepository.findOne!.mockResolvedValue({
        id: 'd1',
        status: DeviceStatus.PROVISIONED,
      });

      await service.generateClaimCode('d1', 'u1');

      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.save).toHaveBeenCalledWith(Device, expect.anything());
    });
  });

  describe('claim', () => {
    const claimDto = { claimCode: '123456', coldRoomId: 'cr1' };

    it('throws ConflictException when the device is not provisioned', async () => {
      devicesRepository.findOne!.mockResolvedValue({
        id: 'd1',
        status: DeviceStatus.REGISTERED,
      });

      await expect(service.claim('d1', claimDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when the claim code has expired', async () => {
      devicesRepository.findOne!.mockResolvedValue({
        id: 'd1',
        status: DeviceStatus.PROVISIONED,
        claimCodeHash: 'hash',
        claimCodeExpiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.claim('d1', claimDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the claim code does not match', async () => {
      devicesRepository.findOne!.mockResolvedValue({
        id: 'd1',
        status: DeviceStatus.PROVISIONED,
        claimCodeHash: 'hash',
        claimCodeExpiresAt: new Date(Date.now() + 60_000),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.claim('d1', claimDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException when the cold room does not exist', async () => {
      devicesRepository.findOne!.mockResolvedValue({
        id: 'd1',
        status: DeviceStatus.PROVISIONED,
        claimCodeHash: 'hash',
        claimCodeExpiresAt: new Date(Date.now() + 60_000),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      coldRoomsRepository.findOne!.mockResolvedValue(null);

      await expect(service.claim('d1', claimDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('assigns the cold room and activates the device', async () => {
      const device = {
        id: 'd1',
        status: DeviceStatus.PROVISIONED,
        claimCodeHash: 'hash',
        claimCodeExpiresAt: new Date(Date.now() + 60_000),
      };
      devicesRepository.findOne!.mockResolvedValue(device);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      coldRoomsRepository.findOne!.mockResolvedValue({ id: 'cr1' });
      devicesRepository.save!.mockImplementation((v: Device) => v);

      const result = await service.claim('d1', claimDto, 'u1');

      expect(manager.save).toHaveBeenLastCalledWith(
        DeviceStatusHistory,
        expect.objectContaining({
          oldStatus: DeviceStatus.PROVISIONED,
          newStatus: DeviceStatus.ACTIVE,
          changedBy: 'u1',
        }),
      );
      expect(result.status).toBe(DeviceStatus.ACTIVE);
      expect(result.coldRoomId).toBe('cr1');
      expect(result.claimCodeHash).toBeNull();
      expect(result.claimedAt).not.toBeNull();
    });

    it("declares the board's default channels in the same transaction", async () => {
      devicesRepository.findOne!.mockResolvedValue({
        id: 'd1',
        status: DeviceStatus.PROVISIONED,
        claimCodeHash: 'hash',
        claimCodeExpiresAt: new Date(Date.now() + 60_000),
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      coldRoomsRepository.findOne!.mockResolvedValue({ id: 'cr1' });

      await service.claim('d1', claimDto, 'u1');

      expect(manager.save).toHaveBeenCalledWith(
        DeviceChannel,
        DEVICE_DEFAULT_CHANNELS.map((c) => ({
          deviceId: 'd1',
          channelType: c.channelType,
          channelRole: CHANNEL_TYPE_ROLE[c.channelType],
          label: c.label,
        })),
      );
    });
  });

  describe('decommission', () => {
    it('throws ConflictException when already decommissioned', async () => {
      devicesRepository.findOne!.mockResolvedValue({
        id: 'd1',
        status: DeviceStatus.DECOMMISSIONED,
      });

      await expect(service.decommission('d1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('sets status and decommissioned_at', async () => {
      const device = { id: 'd1', status: DeviceStatus.ACTIVE };
      devicesRepository.findOne!.mockResolvedValue(device);
      devicesRepository.save!.mockImplementation((v: Device) => v);

      const result = await service.decommission('d1', 'u1');

      expect(manager.save).toHaveBeenLastCalledWith(
        DeviceStatusHistory,
        expect.objectContaining({
          oldStatus: DeviceStatus.ACTIVE,
          newStatus: DeviceStatus.DECOMMISSIONED,
          trigger: DeviceStatusChangeTrigger.MANUAL,
        }),
      );
      expect(result.status).toBe(DeviceStatus.DECOMMISSIONED);
      expect(result.decommissionedAt).not.toBeNull();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      devicesRepository.softDelete!.mockResolvedValue({ affected: 0 });

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes the device', async () => {
      devicesRepository.softDelete!.mockResolvedValue({ affected: 1 });

      await expect(service.remove('d1')).resolves.toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('finds unclaimed devices matching a search term', async () => {
      devicesRepository.findAndCount!.mockResolvedValue([[], 0]);

      await service.findAll(undefined, { unassigned: 'true', search: 'esp' });

      expect(devicesRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { coldRoomId: IsNull(), uniqueId: Like('%esp%') },
            { coldRoomId: IsNull(), firmwareVersion: Like('%esp%') },
          ],
        }),
      );
    });
  });
});
