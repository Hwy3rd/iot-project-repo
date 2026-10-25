import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource, IsNull, LessThanOrEqual } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { AlertStatus } from '../../libs/constants/alert.constant';
import { NotificationStatus } from '../../libs/constants/notification.constant';
import { UserStatus } from '../../libs/constants/user.constant';
import { WebPushService } from '../../libs/web-push/web-push.service';
import { Alert } from '../alerts/entities/alert.entity';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { User } from '../users/entities/user.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { NotificationDelivery } from './entities/notification-delivery.entity';
import { NotificationOutbox } from './entities/notification-outbox.entity';
import { Notification } from './entities/notification.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { NotificationsService } from './notifications.service';

export const PUSH_WINDOW_MS = 6 * 60 * 60 * 1000;
const LEASE_MS = 60_000;

export function retryDelay(attempts: number, retryAfter?: string): number {
  const seconds = Number(retryAfter);
  const requested = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(retryAfter ?? '') - Date.now();
  return Math.max(
    Math.min(300_000, 5000 * 2 ** Math.min(attempts - 1, 6)),
    Number.isFinite(requested) ? Math.max(0, requested) : 0,
  );
}

export function retryablePushError(error: unknown): boolean {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return !status || status === 408 || status === 429 || status >= 500;
}

// MySQL is the durable queue of record. The timer works without Redis;
// BullMQ only wakes it early. Leases recover sends interrupted by a crash.
@Injectable()
export class NotificationRecoveryService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(NotificationRecoveryService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly db: DataSource,
    private readonly notifications: NotificationsService,
    private readonly webPush: WebPushService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), 5000);
    this.timer.unref();
    void this.sweep();
  }

  async onApplicationShutdown() {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }

  sweep(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.recover()
      .catch((error: unknown) => {
        this.logger.error(
          'Notification recovery will retry on next sweep',
          error,
        );
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }

  async processAlert(alertId: string): Promise<void> {
    const found = await this.db.transaction(async (manager) => {
      const outbox = await manager.findOne(NotificationOutbox, {
        where: { id: alertId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!outbox) return false;
      if (outbox.processedAt) return true;
      for (const userId of outbox.recipients) {
        if (
          !(await manager.exists(User, {
            where: { id: userId, status: UserStatus.ACTIVE },
          }))
        )
          continue;
        const dedupeKey = `${outbox.id}:${userId}`;
        if (await manager.exists(Notification, { where: { dedupeKey } }))
          continue;
        await manager.save(
          Notification,
          manager.create(Notification, {
            userId,
            alertId: outbox.id,
            dedupeKey,
            title: outbox.title,
            body: outbox.body,
            createdAt: outbox.createdAt,
            status: NotificationStatus.PENDING,
          }),
        );
      }
      await manager.update(NotificationOutbox, outbox.id, {
        processedAt: new Date(),
      });
      return true;
    });
    // Jobs queued by older releases have no snapshot.
    if (!found) {
      const alert = await this.db
        .getRepository(Alert)
        .findOneBy({ id: alertId });
      if (alert) await this.notifications.notifyNewAlert(alert);
    }
  }

  private async recover(): Promise<void> {
    const outboxes = await this.db.getRepository(NotificationOutbox).find({
      where: { processedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    for (const outbox of outboxes) await this.processAlert(outbox.id);
    const unprepared = await this.db.getRepository(Notification).find({
      where: { deliveryPreparedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    for (const notification of unprepared) await this.prepare(notification.id);
    for (let count = 0; count < 100 && !this.stopping; count++) {
      const delivery = await this.claim();
      if (!delivery) break;
      await this.deliver(delivery);
    }
    const pending = await this.db.getRepository(Notification).find({
      where: { status: NotificationStatus.PENDING },
      take: 100,
    });
    for (const notification of pending)
      await this.updateStatus(notification.id);
  }

  async prepare(id: string): Promise<void> {
    await this.db.transaction(async (manager) => {
      const notification = await manager.findOne(Notification, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!notification || notification.deliveryPreparedAt) return;
      const now = new Date();
      const expiresAt = new Date(
        notification.createdAt.getTime() + PUSH_WINDOW_MS,
      );
      const subscriptions =
        expiresAt > now && notification.status !== NotificationStatus.SENT
          ? await manager.find(PushSubscription, {
              where: { userId: notification.userId },
            })
          : [];
      for (const subscription of subscriptions) {
        await manager.insert(NotificationDelivery, {
          id: uuidv7(),
          notificationId: id,
          subscriptionId: subscription.id,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: now,
          expiresAt,
        });
      }
      await manager.update(Notification, id, {
        deliveryPreparedAt: now,
        ...(subscriptions.length === 0 &&
        notification.status !== NotificationStatus.SENT
          ? { status: NotificationStatus.FAILED }
          : {}),
      });
    });
  }

  async claim(): Promise<NotificationDelivery | null> {
    return this.db.transaction(async (manager) => {
      const delivery = await manager.findOne(NotificationDelivery, {
        where: {
          status: 'pending',
          nextAttemptAt: LessThanOrEqual(new Date()),
        },
        order: { nextAttemptAt: 'ASC' },
        lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
      });
      if (!delivery) return null;
      delivery.leaseToken = uuidv7();
      delivery.attempts++;
      delivery.nextAttemptAt = new Date(Date.now() + LEASE_MS);
      await manager.save(NotificationDelivery, delivery);
      return delivery;
    });
  }

  async deliver(delivery: NotificationDelivery): Promise<void> {
    const notification = await this.db
      .getRepository(Notification)
      .findOneBy({ id: delivery.notificationId });
    const subscription = await this.db
      .getRepository(PushSubscription)
      .findOneBy({ id: delivery.subscriptionId });
    const repo = this.db.getRepository(NotificationDelivery);
    const key = { id: delivery.id, leaseToken: delivery.leaseToken! };
    if (
      !notification ||
      !subscription ||
      subscription.userId !== notification.userId ||
      !(await this.canReceive(notification))
    ) {
      await repo.update(key, {
        status: 'failed',
        lastError: 'Recipient or subscription no longer eligible',
        leaseToken: null,
      });
    } else if (delivery.expiresAt.getTime() <= Date.now()) {
      await repo.update(key, {
        status: 'expired',
        lastError: 'Push delivery window expired',
        leaseToken: null,
      });
    } else {
      try {
        const alert = notification.alertId
          ? await this.db
              .getRepository(Alert)
              .findOneBy({ id: notification.alertId })
          : null;
        const recovered = alert?.status === AlertStatus.RESOLVED;
        const historical = alert?.details?.replayed === true;
        await this.webPush.send(
          subscription,
          JSON.stringify({
            title: historical
              ? `Lịch sử khi mất kết nối: ${notification.title}`
              : recovered
                ? `Sự cố đã kết thúc: ${notification.title}`
                : notification.title,
            body:
              historical || recovered
                ? `Thông báo gửi bù. ${notification.body}`
                : notification.body,
            notificationId: notification.id,
            alertId: notification.alertId,
          }),
          Math.max(
            1,
            Math.ceil((delivery.expiresAt.getTime() - Date.now()) / 1000),
          ),
        );
        await repo.update(key, {
          status: 'sent',
          sentAt: new Date(),
          lastError: null,
          leaseToken: null,
        });
        await this.db
          .getRepository(PushSubscription)
          .update(subscription.id, { lastUsedAt: new Date() });
      } catch (error) {
        const gone = this.webPush.isGone(error);
        const retry = !gone && retryablePushError(error);
        const headers = (error as { headers?: Record<string, string> }).headers;
        await repo.update(key, {
          status: retry ? 'pending' : 'failed',
          leaseToken: null,
          nextAttemptAt: new Date(
            Math.min(
              delivery.expiresAt.getTime(),
              Date.now() +
                retryDelay(delivery.attempts, headers?.['retry-after']),
            ),
          ),
          lastError: `Push failed (${(error as { statusCode?: number }).statusCode ?? 'network'})`,
        });
        if (gone)
          await this.db
            .getRepository(PushSubscription)
            .delete({ id: subscription.id, userId: notification.userId });
      }
    }
    if (notification) await this.updateStatus(notification.id);
  }

  private async canReceive(notification: Notification): Promise<boolean> {
    if (
      !(await this.db
        .getRepository(User)
        .existsBy({ id: notification.userId, status: UserStatus.ACTIVE }))
    )
      return false;
    if (!notification.alertId) return true;
    const alert = await this.db
      .getRepository(Alert)
      .findOneBy({ id: notification.alertId });
    const room = alert
      ? await this.db
          .getRepository(ColdRoom)
          .findOneBy({ id: alert.coldRoomId })
      : null;
    return (
      !!room &&
      this.db.getRepository(WarehouseStaff).existsBy({
        userId: notification.userId,
        warehouseId: room.warehouseId,
      })
    );
  }

  async updateStatus(id: string): Promise<void> {
    await this.db.transaction(async (manager) => {
      const notification = await manager.findOne(Notification, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!notification?.deliveryPreparedAt) return;
      const deliveries = await manager.find(NotificationDelivery, {
        where: { notificationId: id },
      });
      const sent = deliveries.find((delivery) => delivery.status === 'sent');
      await manager.update(Notification, id, {
        status: sent
          ? NotificationStatus.SENT
          : deliveries.some((delivery) => delivery.status === 'pending')
            ? NotificationStatus.PENDING
            : NotificationStatus.FAILED,
        sentAt: notification.sentAt ?? sent?.sentAt ?? null,
      });
    });
  }
}
