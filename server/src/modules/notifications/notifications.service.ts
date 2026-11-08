import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOptionsWhere,
  EntityManager,
  In,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { activeShiftWhere } from '../../common/rbac/warehouse-access.service';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { createdBetween, withSearch } from '../../common/query/find-filters';
import { AlertType } from '../../libs/constants/alert.constant';
import { NotificationStatus } from '../../libs/constants/notification.constant';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import { Alert } from '../alerts/entities/alert.entity';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { User } from '../users/entities/user.entity';
import { WorkShift } from '../work-shifts/entities/work-shift.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { CreatePushSubscriptionDto } from './dto/create-push-subscription.dto';
import { QueryNotificationDto } from './dto/query-notification.dto';
import { Notification } from './entities/notification.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { NotificationOutbox } from './entities/notification-outbox.entity';

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

// Admins aren't assigned to warehouses (they see every one), so they are
// added to every alert's recipients on top of the warehouse's staff.
const ACTIVE_ADMINS = {
  where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
  select: { id: true },
} as const;

// Of the users assigned to `warehouseId`, those who may hear about it now:
// Staff only while on shift there (docs/RBAC.md §3), everyone else always.
async function reachableAssignees(
  manager: EntityManager,
  warehouseId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const staff = await manager.find(User, {
    where: { id: In(userIds), role: UserRole.STAFF },
    select: { id: true },
  });
  if (staff.length === 0) return userIds;
  const onShift = await manager.find(WorkShift, {
    where: {
      staffId: In(staff.map((u) => u.id)),
      warehouseId,
      ...activeShiftWhere(),
    },
    select: { staffId: true },
  });
  const offShift = new Set(staff.map((u) => u.id));
  for (const shift of onShift) offShift.delete(shift.staffId);
  return userIds.filter((id) => !offShift.has(id));
}

const isMysqlDuplicateKeyError = (error: unknown): boolean =>
  error instanceof QueryFailedError &&
  (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY';

// What a fan supply fault (TelemetrySample.fanFault) means for staff.
const FAN_FAULT_MESSAGES: Record<string, string> = {
  no_power: 'Quạt mất nguồn',
  low_voltage: 'Điện áp quạt thấp',
  high_voltage: 'Điện áp quạt cao bất thường',
  stuck_on: 'Quạt đã tắt nhưng vẫn có điện (relay có thể bị dính)',
};

@Injectable()
export class NotificationsService {
  async captureAlert(manager: EntityManager, alert: Alert): Promise<void> {
    const room = await manager.findOne(ColdRoom, {
      where: { id: alert.coldRoomId },
      relations: { warehouse: true },
    });
    const assignments = room
      ? await manager.find(WarehouseStaff, {
          where: { warehouseId: room.warehouseId },
        })
      : [];
    const assignees = room
      ? await reachableAssignees(
          manager,
          room.warehouseId,
          assignments.map((assignment) => assignment.userId),
        )
      : [];
    const admins = await manager.find(User, ACTIVE_ADMINS);
    await manager.insert(NotificationOutbox, {
      id: alert.id,
      recipients: [
        ...new Set([...assignees, ...admins.map((admin) => admin.id)]),
      ],
      ...this.composeMessage(alert, room),
      createdAt: alert.createdAt,
      processedAt: null,
    });
  }
  constructor(
    @InjectRepository(PushSubscription)
    private readonly subscriptionsRepository: Repository<PushSubscription>,
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    @InjectRepository(ColdRoom)
    private readonly coldRoomsRepository: Repository<ColdRoom>,
    @InjectRepository(WarehouseStaff)
    private readonly warehouseStaffRepository: Repository<WarehouseStaff>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
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
  // open). One row per user assigned to the alert's warehouse plus every
  // active admin; the actual
  // push send happens after this, per Notification, in the worker.
  async notifyNewAlert(alert: Alert): Promise<Notification[]> {
    const coldRoom = await this.coldRoomsRepository.findOne({
      where: { id: alert.coldRoomId },
      relations: { warehouse: true },
    });
    if (!coldRoom) {
      return [];
    }
    const staff = await this.warehouseStaffRepository.find({
      where: { warehouseId: coldRoom.warehouseId },
    });
    const assignees = await reachableAssignees(
      this.usersRepository.manager,
      coldRoom.warehouseId,
      staff.map((assignment) => assignment.userId),
    );
    const admins = await this.usersRepository.find(ACTIVE_ADMINS);
    const recipients = [
      ...new Set([...assignees, ...admins.map((admin) => admin.id)]),
    ];
    if (recipients.length === 0) {
      return [];
    }

    const { title, body } = this.composeMessage(alert, coldRoom);
    const notifications = recipients.map((userId) =>
      this.notificationsRepository.create({
        userId,
        alertId: alert.id,
        dedupeKey: `${alert.id}:${userId}`,
        createdAt: alert.createdAt,
        title,
        body,
        status: NotificationStatus.PENDING,
      }),
    );
    // Legacy queue jobs also have to be safe to repeat.
    for (const notification of notifications) {
      try {
        await this.notificationsRepository.save(notification);
      } catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;
      }
    }
    return this.notificationsRepository.find({ where: { alertId: alert.id } });
  }

  // Staff only see the alerts of the warehouses they're on shift at right
  // now (docs/RBAC.md §3) — notifications from an earlier shift elsewhere
  // stay stored but hidden until they're back on shift there.
  async findAll(
    userId: string,
    query: QueryNotificationDto = {},
    role?: UserRole,
  ): Promise<Paginated<Notification>> {
    const where: FindOptionsWhere<Notification> = { userId };
    if (query.unreadOnly === 'true') {
      where.readAt = IsNull();
    }
    const createdAt = createdBetween(query.createdFrom, query.createdTo);
    if (createdAt) where.createdAt = createdAt;
    const scoped = await this.visibleTo(userId, role, where);
    const pagination = resolvePagination(query);
    const [items, total] = await this.notificationsRepository.findAndCount({
      where: (() => {
        const wheres = scoped.flatMap((base) => {
          const searched = withSearch(base, query.search, ['title', 'body']);
          return Array.isArray(searched) ? searched : [searched];
        });
        return wheres.length === 1 ? wheres[0] : wheres;
      })(),
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  // `where` narrowed to what the user may see: everything of theirs, except
  // that Staff only see the alerts of the warehouses they're on shift at.
  // Shared by the list and "mark all read", so the latter never touches a
  // notification the user can't currently see.
  private async visibleTo(
    userId: string,
    role: UserRole | undefined,
    where: FindOptionsWhere<Notification>,
  ): Promise<FindOptionsWhere<Notification>[]> {
    if (role !== UserRole.STAFF) return [where];
    const shifts = await this.usersRepository.manager.find(WorkShift, {
      where: { staffId: userId, ...activeShiftWhere() },
      select: { warehouseId: true },
    });
    const warehouseIds = [...new Set(shifts.map((s) => s.warehouseId))];
    return [
      { ...where, alertId: IsNull() },
      ...(warehouseIds.length
        ? [
            {
              ...where,
              alert: { coldRoom: { warehouseId: In(warehouseIds) } },
            },
          ]
        : []),
    ];
  }

  // Marks every unread notification the user can see as read. Ids first:
  // update() can't filter through the alert → cold room relation.
  async markAllRead(
    userId: string,
    role?: UserRole,
  ): Promise<{ updated: number }> {
    const unread = await this.notificationsRepository.find({
      where: await this.visibleTo(userId, role, {
        userId,
        readAt: IsNull(),
      }),
      select: { id: true },
    });
    if (unread.length === 0) return { updated: 0 };
    const readAt = new Date();
    let updated = 0;
    for (let i = 0; i < unread.length; i += 500) {
      const result = await this.notificationsRepository.update(
        { id: In(unread.slice(i, i + 500).map((n) => n.id)), userId },
        { readAt },
      );
      updated += result.affected ?? 0;
    }
    return { updated };
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

  // The body opens with where it happened ("Kho A › Phòng 1"): the title
  // only says what, and a recipient may watch several warehouses.
  private composeMessage(
    alert: Alert,
    room: ColdRoom | null,
  ): { title: string; body: string } {
    const { title, body } = this.composeDetail(alert);
    const location = [
      room?.warehouse?.name && `Kho ${room.warehouse.name}`,
      room?.name,
    ]
      .filter(Boolean)
      .join(' › ');
    return { title, body: location ? `${location}\n${body}` : body };
  }

  private composeDetail(alert: Alert): { title: string; body: string } {
    const label = ALERT_TYPE_LABELS[alert.type];
    const title =
      alert.details?.replayed === true
        ? `Lịch sử khi mất kết nối: ${label}`
        : label;
    // DEVICE_FAULT carries what failed in details, not a triggerValue (see
    // TelemetryService.evaluateFanPowerAlert).
    const fault = alert.details as {
      kind?: string;
      fanVoltage?: number | null;
      fault?: string | null;
    } | null;
    if (fault?.kind === 'fan_power') {
      const voltage =
        typeof fault.fanVoltage === 'number' ? ` (${fault.fanVoltage} V)` : '';
      const what =
        FAN_FAULT_MESSAGES[fault.fault ?? ''] ?? 'Nguồn quạt bất thường';
      return { title, body: `${what}${voltage}.` };
    }
    // DOOR_OPEN_TOO_LONG: see TelemetryService.evaluateDoorAlert.
    const door = alert.details as {
      openSeconds?: number;
      maxSeconds?: number;
    } | null;
    if (
      alert.type === AlertType.DOOR_OPEN_TOO_LONG &&
      typeof door?.openSeconds === 'number'
    ) {
      const limit =
        typeof door.maxSeconds === 'number'
          ? ` (cho phép ${door.maxSeconds} giây)`
          : '';
      return {
        title,
        body: `Cửa đã mở ${door.openSeconds} giây${limit}.`,
      };
    }
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
