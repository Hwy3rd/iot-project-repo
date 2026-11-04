import { QueryFailedError } from 'typeorm';
import { AlertStatus, AlertType } from '../../libs/constants/alert.constant';
import { Alert } from './entities/alert.entity';
import { AlertsService } from './alerts.service';

describe('Historical offline incidents', () => {
  const input = {
    coldRoomId: 'room-1',
    deviceId: 'device-1',
    type: AlertType.TEMPERATURE_OUT_OF_RANGE,
    triggerValue: 12,
    details: { replayed: true },
  };
  const observedAt = new Date('2026-11-04T03:05:00.000Z');
  const setup = () => {
    const manager = {
      create: jest.fn((_entity: unknown, values: Partial<Alert>) => values),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    const captureAlert = jest.fn().mockResolvedValue(undefined);
    const realtime = { emitToWarehouse: jest.fn() };
    const queue = { add: jest.fn() };
    const service = new AlertsService(
      {
        manager: {
          transaction: (callback: (m: typeof manager) => Promise<void>) =>
            callback(manager),
        },
      } as never,
      {} as never,
      realtime as never,
      queue as never,
      { captureAlert } as never,
    );
    return { service, manager, captureAlert, realtime, queue };
  };

  it('records history and its notification in the same transaction without changing live alerts', async () => {
    const { service, manager, captureAlert, realtime, queue } = setup();
    await service.recordHistorical(input, observedAt);
    const incident = manager.create.mock.results[0].value as Partial<Alert>;
    expect(incident).toMatchObject({
      ...input,
      status: AlertStatus.RESOLVED,
      activeKey: null,
      createdAt: observedAt,
    });
    expect(manager.insert).toHaveBeenCalledWith(Alert, incident);
    expect(captureAlert).toHaveBeenCalledWith(manager, incident);
    expect(realtime.emitToWarehouse).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('uses the same incident ID for a replay in the same device/room/type/hour', async () => {
    const { service, manager, captureAlert } = setup();
    await service.recordHistorical(input, observedAt);
    const first = manager.create.mock.results[0].value as Partial<Alert>;
    manager.insert.mockRejectedValueOnce(
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }),
      ),
    );
    await expect(
      service.recordHistorical(input, new Date('2026-11-04T03:55:00.000Z')),
    ).resolves.toBeUndefined();
    const second = manager.create.mock.results[1].value as Partial<Alert>;
    expect(second.id).toBe(first.id);
    expect(captureAlert).toHaveBeenCalledTimes(1);
    await service.recordHistorical(input, new Date('2026-11-04T04:05:00.000Z'));
    const nextHour = manager.create.mock.results[2].value as Partial<Alert>;
    expect(nextHour.id).not.toBe(first.id);
  });

  it('withholds success when durable notification capture fails', async () => {
    const { service, captureAlert } = setup();
    captureAlert.mockRejectedValueOnce(new Error('MySQL unavailable'));
    await expect(service.recordHistorical(input, observedAt)).rejects.toThrow(
      'MySQL unavailable',
    );
  });
});
