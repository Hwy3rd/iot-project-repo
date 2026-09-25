import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOptionsWhere,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { createdBetween, withSearch } from '../../common/query/find-filters';
import { AlertType } from '../../libs/constants/alert.constant';
import { NotificationStatus } from '../../libs/constants/notification.constant';
import { Alert } from '../alerts/entities/alert.entity';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { CreatePushSubscriptionDto } from './dto/create-push-subscription.dto';
import { QueryNotificationDto } from './dto/query-notification.dto';
import { Notification } from './entities/notification.entity';
import { PushSubscription } from './entities/push-subscription.entity';

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  [AlertType.TEMPERATURE_OUT_OF_RANGE]: 'Nhiệt độ vượt ngưỡng',
  [AlertType.TEMPERATURE_PREDICTED]: 'Dự báo nguy cơ vượt ngưỡng nhiệt độ',
  [AlertType.DEVICE_FAULT]: 'Thiết bị gặp lỗi',
  [AlertType.OFFLINE]: 'Thiết bị mất kết nối',
  [AlertType.DOOR_OPEN_TOO_LONG]: 'Cửa kho mở quá lâu',
  [AlertType.BATCH_TEMPERATURE_OUT_OF_RANGE]:
    'Lô hàng ngoài khoảng nhiệt độ cho phép',
  [AlertType.BATCH_EXPIRING_SOON]: 'Lô hàng sắp hết hạn',
};

const isMysqlDuplicateKeyError = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(PushSubscription)
    private readonly subscriptionsRepository: Repository<PushSubscription>,
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    @InjectRepository(ColdRoom)
    private readonly coldRoomsRepository: Repository<ColdRoom>,
    @InjectRepository(WarehouseStaff)
    private readonly warehouseStaffRepository: Repository<WarehouseStaff>,
  ) {}

  // Upserts on `endpoint`: re-subscribing from the same browser (reinstalled
  // PWA, cleared+redone permission) replaces the row rather than duplicating
  // it. Uses the same try-insert/catch-duplicate pattern as
  // AlertsService.raise() so two tabs subscribing at once can't race into
  // two rows either.
  // userId is the authenticated caller. Re-subscribing an endpoint that's
  // already stored (same browser, e.g. a different person now logged in on
  // it) moves it to this user.
  async subscribe(
    userId: string,
    dto: CreatePushSubscriptionDto,
  ): Promise<PushSubscription> {
    const values = {
      userId,
      p256dhKey: dto.keys.p256dh,
      authKey: dto.keys.auth,
      userAgent: dto.userAgent ?? null,
    };

    try {
      const subscription = this.subscriptionsRepository.create({
        endpoint: dto.endpoint,
        ...values,
      });
      return await this.subscriptionsRepository.save(subscription);
    } catch (error) {
      if (!isMysqlDuplicateKeyError(error)) {
        throw error;
      }
      const existing = await this.subscriptionsRepository.findOne({
        where: { endpoint: dto.endpoint },
      });
      if (!existing) {
        throw error;
      }
      Object.assign(existing, values);
      return this.subscriptionsRepository.save(existing);
    }
  }

  // Idempotent no-op if the endpoint is already gone (matches
  // AlertNotificationProcessor deleting it itself once the push service
  // reports it as expired).
  // Scoped to the caller: you can only remove your own subscription.
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.subscriptionsRepository.delete({ endpoint, userId });
  }

  // Not exposed over HTTP — called by AlertNotificationProcessor for a
  // *newly opened* alert (see AlertsService.raise(), which only enqueues
  // the notification job on that path, never on a refresh of one already
  // open). One row per user assigned to the alert's warehouse; the actual
  // push send happens after this, per Notification, in the worker.
  async notifyNewAlert(alert: Alert): Promise<Notification[]> {
    const coldRoom = await this.coldRoomsRepository.findOne({
      where: { id: alert.coldRoomId },
    });
    if (!coldRoom) {
      return [];
    }
    const staff = await this.warehouseStaffRepository.find({
      where: { warehouseId: coldRoom.warehouseId },
    });
    if (staff.length === 0) {
      return [];
    }

    const { title, body } = this.composeMessage(alert);
    const notifications = staff.map((assignment) =>
      this.notificationsRepository.create({
        userId: assignment.userId,
        alertId: alert.id,
        title,
        body,
        status: NotificationStatus.PENDING,
      }),
    );
    return this.notificationsRepository.save(notifications);
  }

  async findAll(
    userId: string,
    query: QueryNotificationDto = {},
  ): Promise<Paginated<Notification>> {
    const where: FindOptionsWhere<Notification> = { userId };
    if (query.unreadOnly === 'true') {
      where.readAt = IsNull();
    }
    const createdAt = createdBetween(query.createdFrom, query.createdTo);
    if (createdAt) where.createdAt = createdAt;
    const pagination = resolvePagination(query);
    const [items, total] = await this.notificationsRepository.findAndCount({
      where: withSearch(where, query.search, ['title', 'body']),
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  async findOne(id: string): Promise<Notification> {
    const notification = await this.notificationsRepository.findOne({
      where: { id },
    });
    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    return notification;
  }

  // Idempotent: marking an already-read notification as read again just
  // re-stamps read_at, which is harmless — no conflict to guard against
  // here, unlike Alert's acknowledge/resolve.
  async markRead(id: string, userId: string): Promise<Notification> {
    const result = await this.notificationsRepository.update(
      { id, userId },
      { readAt: new Date() },
    );
    if (!result.affected) {
      // Either id doesn't exist or belongs to someone else — same 404
      // either way, so this endpoint never confirms another user's
      // notification ids exist.
      throw new NotFoundException(`Notification ${id} not found`);
    }
    return this.findOne(id);
  }

  private composeMessage(alert: Alert): { title: string; body: string } {
    const title = ALERT_TYPE_LABELS[alert.type];
    if (alert.triggerValue == null) {
      return { title, body: 'Xem chi tiết trong ứng dụng.' };
    }
    const direction = (alert.details as { direction?: string } | null)
      ?.direction;
    const directionLabel =
      direction === 'high'
        ? ' (cao hơn ngưỡng)'
        : direction === 'low'
          ? ' (thấp hơn ngưỡng)'
          : '';
    return {
      title,
      body: `Giá trị: ${alert.triggerValue}${directionLabel}`,
    };
  }
}
