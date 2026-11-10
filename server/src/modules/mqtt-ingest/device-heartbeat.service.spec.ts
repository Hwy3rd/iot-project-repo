import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import { AlertType } from '../../libs/constants/alert.constant';
import {
  DeviceStatus,
  DeviceStatusChangeTrigger,
} from '../../libs/constants/device.constant';
import { AlertsService } from '../alerts/alerts.service';
import { DeviceStatusHistory } from '../device-status-history/entities/device-status-history.entity';
import { Device } from '../devices/entities/device.entity';
import {
  DeviceHeartbeatService,
  offlineAfterMs,
  sweepIntervalMs,
} from './device-heartbeat.service';

describe('DeviceHeartbeatService', () => {
  let service: DeviceHeartbeatService;
  let stale: Partial<Device>[];
  let queryBuilder: {
    where: jest.Mock;
    andWhere: jest.Mock;
    getMany: jest.Mock;
  };
  let manager: {
    transaction: jest.Mock;
    update: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let alertsService: { raise: jest.Mock };

  beforeEach(async () => {
    stale = [];
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(() => Promise.resolve(stale)),
    };
    manager = {
      transaction: jest.fn((cb: (m: unknown) => Promise<unknown>) =>
        cb(manager),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(),
      create: jest.fn((_e: unknown, v: unknown) => v),
    };
    alertsService = { raise: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceHeartbeatService,
        {
          provide: getRepositoryToken(Device),
          useValue: { createQueryBuilder: () => queryBuilder, manager },
        },
        { provide: AlertsService, useValue: alertsService },
      ],
    }).compile();

    service = module.get(DeviceHeartbeatService);
  });

  it('marks a silent ACTIVE device OFFLINE, logs history and raises an alert', async () => {
    const lastHeartbeatAt = new Date('2026-10-28T08:00:00Z');
    stale.push({
      id: 'd1',
      uniqueId: 'esp32-01',
      coldRoomId: 'r1',
      lastHeartbeatAt,
    });

    await service.sweep();

    expect(queryBuilder.where).toHaveBeenCalledWith('d.status = :status', {
      status: DeviceStatus.ACTIVE,
    });
    expect(manager.update).toHaveBeenCalledWith(
      Device,
      { id: 'd1', status: DeviceStatus.ACTIVE, lastHeartbeatAt },
      { status: DeviceStatus.OFFLINE },
    );
    expect(manager.save).toHaveBeenCalledWith(DeviceStatusHistory, {
      deviceId: 'd1',
      oldStatus: DeviceStatus.ACTIVE,
      newStatus: DeviceStatus.OFFLINE,
      trigger: DeviceStatusChangeTrigger.AUTOMATED,
      reason: 'Heartbeat timeout',
    });
    expect(alertsService.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        type: AlertType.OFFLINE,
        deviceId: 'd1',
        coldRoomId: 'r1',
      }),
    );
  });

  it('leaves the device alone when a heartbeat landed meanwhile', async () => {
    stale.push({
      id: 'd1',
      uniqueId: 'esp32-01',
      coldRoomId: 'r1',
      lastHeartbeatAt: new Date(),
    });
    manager.update.mockResolvedValue({ affected: 0 });

    await service.sweep();

    expect(manager.save).not.toHaveBeenCalled();
    expect(alertsService.raise).not.toHaveBeenCalled();
  });

  it('handles a device that never sent a heartbeat and has no room', async () => {
    stale.push({
      id: 'd2',
      uniqueId: 'esp32-02',
      coldRoomId: null,
      lastHeartbeatAt: null,
    });

    await service.sweep();

    expect(manager.update).toHaveBeenCalledWith(
      Device,
      { id: 'd2', status: DeviceStatus.ACTIVE, lastHeartbeatAt: IsNull() },
      { status: DeviceStatus.OFFLINE },
    );
    expect(manager.save).toHaveBeenCalled();
    expect(alertsService.raise).not.toHaveBeenCalled();
  });

  it('keeps sweeping the other devices when one fails', async () => {
    stale.push(
      { id: 'd1', uniqueId: 'a', coldRoomId: 'r1', lastHeartbeatAt: null },
      { id: 'd2', uniqueId: 'b', coldRoomId: 'r1', lastHeartbeatAt: null },
    );
    alertsService.raise.mockRejectedValueOnce(new Error('MySQL offline'));

    await service.sweep();

    expect(alertsService.raise).toHaveBeenCalledTimes(2);
  });

  it('goes offline after 15 s by default, configurable down to 10 s', () => {
    expect(offlineAfterMs(undefined)).toBe(15_000);
    expect(offlineAfterMs('120000')).toBe(120_000);
    expect(offlineAfterMs('10000')).toBe(10_000);
    expect(offlineAfterMs('5000')).toBe(15_000);
    expect(offlineAfterMs('abc')).toBe(15_000);
  });

  it('sweeps every second by default', () => {
    expect(sweepIntervalMs(undefined)).toBe(1_000);
    expect(sweepIntervalMs('5000')).toBe(5_000);
    expect(sweepIntervalMs('1000')).toBe(1_000);
    expect(sweepIntervalMs('500')).toBe(1_000);
    expect(sweepIntervalMs('abc')).toBe(1_000);
  });
});
