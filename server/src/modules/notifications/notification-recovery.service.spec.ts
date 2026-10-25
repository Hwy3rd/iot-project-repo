import {
  NotificationRecoveryService,
  retryDelay,
  retryablePushError,
  PUSH_WINDOW_MS,
} from './notification-recovery.service';
import { NotificationOutbox } from './entities/notification-outbox.entity';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { Notification } from './entities/notification.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { Alert } from '../alerts/entities/alert.entity';
import { User } from '../users/entities/user.entity';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { FindOperator } from 'typeorm';

interface TestRow {
  id?: string;
  userId?: string;
  warehouseId?: string;
  coldRoomId?: string;
  status?: string;
  recipients?: string[];
  title?: string;
  body?: string;
  createdAt?: Date;
  processedAt?: Date | null;
  [key: string]: unknown;
}
type Where = Record<string, unknown>;
type Options = { where?: Where; take?: number };

// Stateful persistence double: restarts keep DB rows, not service memory.
function database() {
  const tables = new Map<unknown, TestRow[]>();
  const rows = (entity: unknown): TestRow[] => {
    if (!tables.has(entity)) tables.set(entity, []);
    return tables.get(entity)!;
  };
  const matches = (row: TestRow, where: Where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value instanceof FindOperator && value.type === 'isNull')
        return row[key] == null;
      if (value instanceof FindOperator && value.type === 'lessThanOrEqual')
        return Number(row[key]) <= Number(value.value);
      return row[key] === value;
    });
  const repo = (entity: unknown) => ({
    find: (options: Options = {}) =>
      Promise.resolve(
        rows(entity)
          .filter((row) => matches(row, options.where))
          .slice(0, options.take ?? Infinity),
      ),
    findOne: (options: Options) =>
      Promise.resolve(
        rows(entity).find((row) => matches(row, options.where)) ?? null,
      ),
    findOneBy: (where: Where) =>
      Promise.resolve(rows(entity).find((row) => matches(row, where)) ?? null),
    existsBy: (where: Where) =>
      Promise.resolve(rows(entity).some((row) => matches(row, where))),
    update: (key: string | Where, value: TestRow) => {
      const matching = rows(entity).filter((row) =>
        matches(row, typeof key === 'string' ? { id: key } : key),
      );
      matching.forEach((row) => {
        Object.assign(row, value);
      });
      return Promise.resolve({ affected: matching.length });
    },
    delete: (key: string | Where) => {
      tables.set(
        entity,
        rows(entity).filter(
          (row) => !matches(row, typeof key === 'string' ? { id: key } : key),
        ),
      );
      return Promise.resolve();
    },
  });
  const manager = {
    find: (entity: unknown, options: Options) => repo(entity).find(options),
    findOne: (entity: unknown, options: Options) =>
      repo(entity).findOne(options),
    exists: (entity: unknown, options: Options) =>
      repo(entity).existsBy(options.where ?? {}),
    create: (_entity: unknown, value: TestRow) => value,
    save: (entity: unknown, value: TestRow) => {
      value.id ??= `id-${rows(entity).length}`;
      const old = rows(entity).find((row) => row.id === value.id);
      if (old) Object.assign(old, value);
      else rows(entity).push(value);
      return Promise.resolve(value);
    },
    insert: (entity: unknown, value: TestRow) => {
      rows(entity).push(value);
      return Promise.resolve();
    },
    update: (entity: unknown, key: string | Where, value: TestRow) =>
      repo(entity).update(key, value),
  };
  return {
    rows,
    getRepository: repo,
    transaction: async (
      callback: (entityManager: typeof manager) => Promise<unknown>,
    ) => {
      const snapshot = new Map(
        [...tables].map(([entity, values]) => [
          entity,
          structuredClone(values),
        ]),
      );
      try {
        return await callback(manager);
      } catch (error) {
        tables.clear();
        snapshot.forEach((value, key) => tables.set(key, value));
        throw error;
      }
    },
  };
}

describe('Durable notification recovery', () => {
  let db: ReturnType<typeof database>;
  let webPush: {
    send: jest.Mock<Promise<void>, [PushSubscription, string, number?]>;
    isGone: jest.Mock<boolean, [unknown]>;
  };
  let recovery: NotificationRecoveryService;
  const now = new Date('2026-10-25T10:00:00Z');
  const restart = () =>
    new NotificationRecoveryService(
      db as never,
      { notifyNewAlert: jest.fn() } as never,
      webPush as never,
    );

  beforeEach(() => {
    jest.useFakeTimers({ now });
    db = database();
    webPush = {
      send: jest
        .fn<Promise<void>, [PushSubscription, string, number?]>()
        .mockResolvedValue(undefined),
      isGone: jest.fn((error: unknown) =>
        [404, 410].includes(
          (error as { statusCode?: number } | null)?.statusCode ?? 0,
        ),
      ),
    };
    recovery = restart();
    db.rows(User).push({ id: 'u1', status: 'active' });
    db.rows(ColdRoom).push({ id: 'r1', warehouseId: 'w1' });
    db.rows(WarehouseStaff).push({ userId: 'u1', warehouseId: 'w1' });
    db.rows(Alert).push({ id: 'a1', coldRoomId: 'r1', status: 'open' });
    db.rows(NotificationOutbox).push({
      id: 'a1',
      recipients: ['u1'],
      title: 'Cảnh báo',
      body: 'Nhiệt độ cao',
      createdAt: now,
      processedAt: null,
    });
    db.rows(PushSubscription).push({ id: 's1', userId: 'u1' });
  });
  afterEach(() => jest.useRealTimers());

  it('recovers a committed outbox without any Redis job, and does not resend after restart', async () => {
    await recovery.sweep();
    expect(db.rows(Notification)).toHaveLength(1);
    expect(db.rows(NotificationDelivery)[0].status).toBe('sent');
    expect(db.rows(NotificationOutbox)[0].processedAt).toEqual(now);
    recovery = restart();
    await recovery.processAlert('a1');
    await recovery.sweep();
    expect(db.rows(Notification)).toHaveLength(1);
    expect(webPush.send).toHaveBeenCalledTimes(1);
  });

  it('keeps a network failure durable and retries after restart/backoff', async () => {
    webPush.send.mockRejectedValueOnce(new Error('offline'));
    await recovery.sweep();
    expect(db.rows(NotificationDelivery)[0]).toMatchObject({
      status: 'pending',
      attempts: 1,
    });
    expect(db.rows(Notification)[0].status).toBe('pending');
    recovery = restart();
    await recovery.sweep();
    expect(webPush.send).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    await recovery.sweep();
    expect(webPush.send).toHaveBeenCalledTimes(2);
    expect(db.rows(NotificationDelivery)[0].status).toBe('sent');
  });

  it('retries only the failed browser, even after the aggregate notification is sent', async () => {
    db.rows(PushSubscription).push({ id: 's2', userId: 'u1' });
    webPush.send.mockImplementation((subscription) =>
      subscription.id === 's2'
        ? Promise.reject(
            Object.assign(new Error('Provider unavailable'), {
              statusCode: 503,
            }),
          )
        : Promise.resolve(),
    );
    await recovery.sweep();
    expect(db.rows(Notification)[0].status).toBe('sent');
    webPush.send.mockResolvedValue(undefined);
    jest.advanceTimersByTime(5000);
    await recovery.sweep();
    expect(
      webPush.send.mock.calls.filter(
        ([subscription]) => subscription.id === 's1',
      ),
    ).toHaveLength(1);
    expect(
      db
        .rows(NotificationDelivery)
        .every((delivery) => delivery.status === 'sent'),
    ).toBe(true);
  });

  it.each([400, 403, 404, 410])(
    'does not retry permanent push error %s',
    async (statusCode) => {
      webPush.send.mockRejectedValue({ statusCode });
      await recovery.sweep();
      jest.advanceTimersByTime(60_000);
      await recovery.sweep();
      expect(webPush.send).toHaveBeenCalledTimes(1);
      expect(db.rows(NotificationDelivery)[0].status).toBe('failed');
      expect(db.rows(PushSubscription)).toHaveLength(
        [404, 410].includes(statusCode) ? 0 : 1,
      );
    },
  );

  it('stops retrying expired pushes but retains the in-app notification', async () => {
    webPush.send.mockRejectedValue(new Error('offline'));
    await recovery.sweep();
    jest.advanceTimersByTime(PUSH_WINDOW_MS + 1);
    await recovery.sweep();
    expect(db.rows(NotificationDelivery)[0].status).toBe('expired');
    expect(db.rows(Notification)).toHaveLength(1);
    expect(webPush.send).toHaveBeenCalledTimes(1);
  });

  it('does not leak a pending push after the browser moves to another user', async () => {
    await recovery.processAlert('a1');
    await recovery.prepare(db.rows(Notification)[0].id!);
    db.rows(PushSubscription)[0].userId = 'u2';
    await recovery.sweep();
    expect(webPush.send).not.toHaveBeenCalled();
  });

  it('does not send pending pushes after warehouse access is revoked', async () => {
    db.rows(WarehouseStaff).length = 0;
    await recovery.sweep();
    expect(webPush.send).not.toHaveBeenCalled();
  });

  it('reclaims the leased send when a worker dies before delivery', async () => {
    await recovery.processAlert('a1');
    await recovery.prepare(db.rows(Notification)[0].id!);
    const first = structuredClone(await recovery.claim());
    expect(first?.leaseToken).toBeTruthy();
    recovery = restart();
    expect(await recovery.claim()).toBeNull();
    jest.advanceTimersByTime(60_000);
    const second = await recovery.claim();
    expect(second?.leaseToken).not.toBe(first?.leaseToken);
    await recovery.deliver(second!);
    expect(db.rows(NotificationDelivery)[0].status).toBe('sent');
  });

  it('labels delayed resolved incidents as historical', async () => {
    db.rows(Alert)[0].status = 'resolved';
    await recovery.sweep();
    const payload = JSON.parse(webPush.send.mock.calls[0][1]) as {
      title: string;
      body: string;
    };
    expect(payload.title).toContain('Sự cố đã kết thúc');
    expect(payload.body).toContain('gửi bù');
  });

  it('keeps notification history when the user has no push subscription', async () => {
    db.rows(PushSubscription).length = 0;
    await recovery.sweep();
    expect(db.rows(Notification)[0].status).toBe('failed');
    expect(db.rows(NotificationDelivery)).toHaveLength(0);
  });

  it('uses capped exponential delay and honours Retry-After', () => {
    expect(retryDelay(1)).toBe(5000);
    expect(retryDelay(2)).toBe(10_000);
    expect(retryDelay(20)).toBe(300_000);
    expect(retryDelay(1, '120')).toBe(120_000);
    expect(retryablePushError({ statusCode: 429 })).toBe(true);
    expect(retryablePushError({ statusCode: 401 })).toBe(false);
  });
});
