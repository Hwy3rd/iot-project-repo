import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { QueryFailedError, Repository } from 'typeorm';
import { DeviceStatus } from '../../libs/constants/device.constant';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { DevicesService } from './devices.service';
import { Device } from './entities/device.entity';

jest.mock('bcryptjs');

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  softDelete: jest.fn(),
});

describe('DevicesService', () => {
  let service: DevicesService;
  let devicesRepository: MockRepository<Device>;
  let coldRoomsRepository: MockRepository<ColdRoom>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevicesService,
        {
          provide: getRepositoryToken(Device),
          useValue: createMockRepository<Device>(),
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

      const result = await service.generateClaimCode('d1');

      expect(device.status).toBe(DeviceStatus.PROVISIONED);
      expect(result.claimCode).toMatch(/^\d{6}$/);
      expect(result.claimCodeExpiresAt).toBeInstanceOf(Date);
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

      const result = await service.claim('d1', claimDto);

      expect(result.status).toBe(DeviceStatus.ACTIVE);
      expect(result.coldRoomId).toBe('cr1');
      expect(result.claimCodeHash).toBeNull();
      expect(result.claimedAt).not.toBeNull();
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

      const result = await service.decommission('d1');

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
});
