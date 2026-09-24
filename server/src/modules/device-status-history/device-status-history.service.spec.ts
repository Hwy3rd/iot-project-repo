import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DeviceStatus,
  DeviceStatusChangeTrigger,
} from '../../libs/constants/device.constant';
import { Device } from '../devices/entities/device.entity';
import { DeviceStatusHistoryService } from './device-status-history.service';
import { DeviceStatusHistory } from './entities/device-status-history.entity';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  existsBy: jest.fn(),
});

describe('DeviceStatusHistoryService', () => {
  let service: DeviceStatusHistoryService;
  let historyRepository: MockRepository<DeviceStatusHistory>;
  let devicesRepository: MockRepository<Device>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceStatusHistoryService,
        {
          provide: getRepositoryToken(DeviceStatusHistory),
          useValue: createMockRepository<DeviceStatusHistory>(),
        },
        {
          provide: getRepositoryToken(Device),
          useValue: createMockRepository<Device>(),
        },
      ],
    }).compile();

    service = module.get(DeviceStatusHistoryService);
    historyRepository = module.get(getRepositoryToken(DeviceStatusHistory));
    devicesRepository = module.get(getRepositoryToken(Device));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('record', () => {
    it('throws when oldStatus equals newStatus', async () => {
      await expect(
        service.record({
          deviceId: 'd1',
          oldStatus: DeviceStatus.PROVISIONED,
          newStatus: DeviceStatus.PROVISIONED,
          trigger: DeviceStatusChangeTrigger.MANUAL,
        }),
      ).rejects.toThrow('no actual status change');
      expect(historyRepository.create).not.toHaveBeenCalled();
    });

    it('records a manual transition with the acting user', async () => {
      historyRepository.create!.mockImplementation(
        (v: Partial<DeviceStatusHistory>) => v,
      );
      historyRepository.save!.mockImplementation(
        (v: Partial<DeviceStatusHistory>) => ({ id: 'h1', ...v }),
      );

      const result = await service.record({
        deviceId: 'd1',
        oldStatus: DeviceStatus.PROVISIONED,
        newStatus: DeviceStatus.ACTIVE,
        trigger: DeviceStatusChangeTrigger.MANUAL,
        changedBy: 'u1',
        reason: 'Claimed into cold room A',
      });

      expect(historyRepository.create).toHaveBeenCalledWith({
        deviceId: 'd1',
        oldStatus: DeviceStatus.PROVISIONED,
        newStatus: DeviceStatus.ACTIVE,
        trigger: DeviceStatusChangeTrigger.MANUAL,
        changedBy: 'u1',
        reason: 'Claimed into cold room A',
      });
      expect(result).toMatchObject({ id: 'h1' });
    });

    it('records an automated transition with no actor', async () => {
      historyRepository.create!.mockImplementation(
        (v: Partial<DeviceStatusHistory>) => v,
      );
      historyRepository.save!.mockImplementation(
        (v: Partial<DeviceStatusHistory>) => v,
      );

      await service.record({
        deviceId: 'd1',
        oldStatus: DeviceStatus.ACTIVE,
        newStatus: DeviceStatus.OFFLINE,
        trigger: DeviceStatusChangeTrigger.AUTOMATED,
      });

      expect(historyRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ changedBy: null, reason: null }),
      );
    });

    it("allows oldStatus null for a device's first entry", async () => {
      historyRepository.create!.mockImplementation(
        (v: Partial<DeviceStatusHistory>) => v,
      );
      historyRepository.save!.mockImplementation(
        (v: Partial<DeviceStatusHistory>) => v,
      );

      await service.record({
        deviceId: 'd1',
        oldStatus: null,
        newStatus: DeviceStatus.REGISTERED,
        trigger: DeviceStatusChangeTrigger.AUTOMATED,
      });

      expect(historyRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ oldStatus: null }),
      );
    });
  });

  describe('findAllForDevice', () => {
    it('throws NotFoundException when the device does not exist', async () => {
      devicesRepository.existsBy!.mockResolvedValue(false);

      await expect(service.findAllForDevice('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(historyRepository.findAndCount).not.toHaveBeenCalled();
    });

    it('returns entries newest first', async () => {
      devicesRepository.existsBy!.mockResolvedValue(true);
      historyRepository.findAndCount!.mockResolvedValue([[], 0]);

      await service.findAllForDevice('d1');

      expect(historyRepository.findAndCount).toHaveBeenCalledWith({
        where: { deviceId: 'd1' },
        order: { changedAt: 'DESC', id: 'DESC' },
        skip: 0,
        take: 20,
      });
    });
  });
});
