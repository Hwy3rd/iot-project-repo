import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, IsNull, QueryFailedError, Repository } from 'typeorm';
import { AlertType } from '../../libs/constants/alert.constant';
import { NotificationStatus } from '../../libs/constants/notification.constant';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import { Alert } from '../alerts/entities/alert.entity';
import { User } from '../users/entities/user.entity';
import { WorkShift } from '../work-shifts/entities/work-shift.entity';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { Notification } from './entities/notification.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { NotificationsService } from './notifications.service';
import { NotificationOutbox } from './entities/notification-outbox.entity';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

const duplicateKeyError = () =>
  new QueryFailedError('INSERT ...', [], {
    name: 'Error',
    message: 'Duplicate entry',
    code: 'ER_DUP_ENTRY',
  } as unknown as Error);

describe('NotificationsService', () => {
  let service: NotificationsService;
  let subscriptionsRepository: MockRepository<PushSubscription>;
  let notificationsRepository: MockRepository<Notification>;
  let coldRoomsRepository: MockRepository<ColdRoom>;
  let warehouseStaffRepository: MockRepository<WarehouseStaff>;
  let usersRepository: MockRepository<User>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getRepositoryToken(PushSubscription),
          useValue: createMockRepository<PushSubscription>(),
        },
        {
          provide: getRepositoryToken(Notification),
          useValue: createMockRepository<Notification>(),
        },
        {
          provide: getRepositoryToken(ColdRoom),
          useValue: createMockRepository<ColdRoom>(),
        },
        {
          provide: getRepositoryToken(WarehouseStaff),
          useValue: createMockRepository<WarehouseStaff>(),
        },
        {
          provide: getRepositoryToken(User),
          useValue: createMockRepository<User>(),
        },
      ],
    }).compile();

    service = module.get(NotificationsService);
    subscriptionsRepository = module.get(getRepositoryToken(PushSubscription));
    notificationsRepository = module.get(getRepositoryToken(Notification));
    notificationsRepository.find!.mockImplementation(() =>
      Promise.resolve(
        notificationsRepository.create!.mock.results.map(
          (result) => result.value as Notification,
        ),
      ),
    );
    coldRoomsRepository = module.get(getRepositoryToken(ColdRoom));
    warehouseStaffRepository = module.get(getRepositoryToken(WarehouseStaff));
    usersRepository = module.get(getRepositoryToken(User));
    usersRepository.find!.mockResolvedValue([]);
    // reachableAssignees(): nobody assigned is Staff unless a test says so.
    (usersRepository as { manager?: unknown }).manager = {
      find: jest.fn().mockResolvedValue([]),
    };
  });

  describe('subscribe', () => {
    const dto = {
      endpoint: 'https://push.example/1',
      keys: { p256dh: 'p', auth: 'a' },
    };

    it('creates a new subscription row', async () => {
      subscriptionsRepository.create!.mockImplementation(
        (v: Partial<PushSubscription>) => v,
      );
      subscriptionsRepository.save!.mockImplementation(
        (v: Partial<PushSubscription>) => ({ id: 's1', ...v }),
      );

      const result = await service.subscribe('u1', dto);

      expect(subscriptionsRepository.create).toHaveBeenCalledWith({
        endpoint: 'https://push.example/1',
        userId: 'u1',
        p256dhKey: 'p',
        authKey: 'a',
        userAgent: null,
      });
      expect(result).toMatchObject({ id: 's1', userId: 'u1' });
    });

    it('upserts onto the existing row when the endpoint collides', async () => {
      subscriptionsRepository.create!.mockImplementation(
        (v: Partial<PushSubscription>) => v,
      );
      subscriptionsRepository
        .save!.mockRejectedValueOnce(duplicateKeyError())
        .mockImplementation((v: Partial<PushSubscription>) => v);
      const existing = {
        id: 's1',
        endpoint: dto.endpoint,
        p256dhKey: 'old',
        authKey: 'old',
      };
      subscriptionsRepository.findOne!.mockResolvedValue(existing);

      const result = await service.subscribe('u1', dto);

      expect(subscriptionsRepository.findOne).toHaveBeenCalledWith({
        where: { endpoint: dto.endpoint },
      });
      expect(existing.p256dhKey).toBe('p');
      expect(existing.authKey).toBe('a');
      expect(result).toBe(existing);
    });

    it('rethrows a non-duplicate-key write error', async () => {
      subscriptionsRepository.create!.mockImplementation(
        (v: Partial<PushSubscription>) => v,
      );
      subscriptionsRepository.save!.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(service.subscribe('u1', dto)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('unsubscribe', () => {
    it('deletes by endpoint, idempotently', async () => {
      subscriptionsRepository.delete!.mockResolvedValue({ affected: 0 });

      await expect(
        service.unsubscribe('u1', 'https://push.example/gone'),
      ).resolves.toBeUndefined();
      expect(subscriptionsRepository.delete).toHaveBeenCalledWith({
        endpoint: 'https://push.example/gone',
        userId: 'u1',
      });
    });
  });

  describe('notifyNewAlert', () => {
    it('captures immutable recipients, content and occurrence time using the alert transaction manager', async () => {
      const createdAt = new Date('2026-10-25T10:00:00Z');
      const manager = {
        findOne: jest.fn().mockResolvedValue({ warehouseId: 'w1' }),
        find: jest.fn(
          (entity: unknown, options: { where: { role?: UserRole } }) =>
            Promise.resolve(
              entity === User
                ? options.where.role === UserRole.ADMIN
                  ? [{ id: 'admin1' }, { id: 'u2' }]
                  : []
                : [{ userId: 'u1' }, { userId: 'u1' }, { userId: 'u2' }],
            ),
        ),
        insert: jest.fn(),
      };
      await service.captureAlert(
        manager as never,
        {
          id: 'a1',
          coldRoomId: 'c1',
          type: AlertType.OFFLINE,
          createdAt,
        } as Alert,
      );
      expect(manager.insert).toHaveBeenCalledWith(
        NotificationOutbox,
        expect.objectContaining({
          id: 'a1',
          recipients: ['u1', 'u2', 'admin1'],
          createdAt,
          processedAt: null,
        }),
      );
      expect(notificationsRepository.save).not.toHaveBeenCalled();
      expect(manager.find).toHaveBeenCalledWith(User, {
        where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
        select: { id: true },
      });
    });
    it('leaves out Staff who are not on shift at the warehouse', async () => {
      const manager = {
        findOne: jest.fn().mockResolvedValue({ warehouseId: 'w1' }),
        find: jest.fn(
          (entity: unknown, options: { where: { role?: UserRole } }) =>
            Promise.resolve(
              entity === User
                ? options.where.role === UserRole.STAFF
                  ? [{ id: 'staffOn' }, { id: 'staffOff' }]
                  : []
                : entity === WorkShift
                  ? [{ staffId: 'staffOn' }]
                  : [
                      { userId: 'manager1' },
                      { userId: 'staffOn' },
                      { userId: 'staffOff' },
                    ],
            ),
        ),
        insert: jest.fn(),
      };

      await service.captureAlert(
        manager as never,
        { id: 'a2', coldRoomId: 'c1', type: AlertType.OFFLINE } as Alert,
      );

      expect(manager.find).toHaveBeenCalledWith(
        WorkShift,
        expect.objectContaining({
          where: expect.objectContaining({ warehouseId: 'w1' }) as unknown,
        }),
      );
      expect(manager.insert).toHaveBeenCalledWith(
        NotificationOutbox,
        expect.objectContaining({ recipients: ['manager1', 'staffOn'] }),
      );
    });

    const alert = {
      id: 'al1',
      coldRoomId: 'c1',
      type: AlertType.TEMPERATURE_OUT_OF_RANGE,
      triggerValue: -10,
      details: { direction: 'high' },
    } as unknown as Alert;

    it('returns [] when the cold room cannot be resolved', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue(null);

      const result = await service.notifyNewAlert(alert);

      expect(result).toEqual([]);
      expect(warehouseStaffRepository.find).not.toHaveBeenCalled();
    });

    it('also notifies active admins, once each, even with no staff assigned', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({ warehouseId: 'w1' });
      warehouseStaffRepository.find!.mockResolvedValue([]);
      usersRepository.find!.mockResolvedValue([{ id: 'admin1' }]);
      notificationsRepository.create!.mockImplementation(
        (v: Partial<Notification>) => v,
      );

      const result = await service.notifyNewAlert(alert);

      expect(usersRepository.find).toHaveBeenCalledWith({
        where: { role: UserRole.ADMIN, status: UserStatus.ACTIVE },
        select: { id: true },
      });
      expect(notificationsRepository.create).toHaveBeenCalledTimes(1);
      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'admin1', dedupeKey: 'al1:admin1' }),
      );
      expect(result).toHaveLength(1);
    });

    it('returns [] when nobody is assigned to the warehouse and there is no admin', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({ warehouseId: 'w1' });
      warehouseStaffRepository.find!.mockResolvedValue([]);

      const result = await service.notifyNewAlert(alert);

      expect(result).toEqual([]);
      expect(notificationsRepository.create).not.toHaveBeenCalled();
    });

    it('creates one notification per assigned staff member with a composed message', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({ warehouseId: 'w1' });
      warehouseStaffRepository.find!.mockResolvedValue([
        { userId: 'u1' },
        { userId: 'u2' },
      ]);
      notificationsRepository.create!.mockImplementation(
        (v: Partial<Notification>) => v,
      );
      notificationsRepository.save!.mockImplementation(
        (v: Partial<Notification>[]) => v,
      );

      const result = await service.notifyNewAlert(alert);

      expect(warehouseStaffRepository.find).toHaveBeenCalledWith({
        where: { warehouseId: 'w1' },
      });
      expect(notificationsRepository.create).toHaveBeenCalledTimes(2);
      expect(notificationsRepository.create).toHaveBeenCalledWith({
        userId: 'u1',
        alertId: 'al1',
        dedupeKey: 'al1:u1',
        createdAt: undefined,
        title: 'Nhiệt độ vượt ngưỡng',
        body: 'Giá trị: -10 (cao hơn ngưỡng)',
        status: NotificationStatus.PENDING,
      });
      expect(result).toHaveLength(2);
    });

    it('falls back to a generic body when there is no trigger value', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({ warehouseId: 'w1' });
      warehouseStaffRepository.find!.mockResolvedValue([{ userId: 'u1' }]);
      notificationsRepository.create!.mockImplementation(
        (v: Partial<Notification>) => v,
      );
      notificationsRepository.save!.mockImplementation(
        (v: Partial<Notification>[]) => v,
      );

      await service.notifyNewAlert({
        id: 'al2',
        coldRoomId: 'c1',
        type: AlertType.OFFLINE,
        triggerValue: null,
        details: null,
      } as unknown as Alert);

      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Thiết bị mất kết nối',
          body: 'Xem chi tiết trong ứng dụng.',
        }),
      );
    });

    it('labels recovered incidents in the in-app notification as historical', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({ warehouseId: 'w1' });
      warehouseStaffRepository.find!.mockResolvedValue([{ userId: 'u1' }]);
      notificationsRepository.create!.mockImplementation(
        (v: Partial<Notification>) => v,
      );
      notificationsRepository.save!.mockImplementation(
        (v: Partial<Notification>) => v,
      );
      await service.notifyNewAlert({
        ...alert,
        details: { replayed: true },
      });
      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Lịch sử khi mất kết nối: Nhiệt độ vượt ngưỡng',
        }),
      );
    });

    it('describes a fan power fault with the measured voltage', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({ warehouseId: 'w1' });
      warehouseStaffRepository.find!.mockResolvedValue([{ userId: 'u1' }]);
      notificationsRepository.create!.mockImplementation(
        (v: Partial<Notification>) => v,
      );
      notificationsRepository.save!.mockImplementation(
        (v: Partial<Notification>[]) => v,
      );

      await service.notifyNewAlert({
        id: 'al3',
        coldRoomId: 'c1',
        type: AlertType.DEVICE_FAULT,
        triggerValue: null,
        details: { kind: 'fan_power', fanVoltage: 0.3 },
      } as unknown as Alert);

      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Thiết bị gặp lỗi',
          body: 'Nguồn quạt bất thường (0.3 V).',
        }),
      );
    });

    it.each([
      ['no_power', 'Quạt mất nguồn (0 V).'],
      ['low_voltage', 'Điện áp quạt thấp (0 V).'],
      ['high_voltage', 'Điện áp quạt cao bất thường (0 V).'],
      [
        'stuck_on',
        'Quạt đã tắt nhưng vẫn có điện (relay có thể bị dính) (0 V).',
      ],
    ])('says what the %s fan fault is', async (fault, body) => {
      coldRoomsRepository.findOne!.mockResolvedValue({
        id: 'c1',
        warehouseId: 'w1',
      });
      warehouseStaffRepository.find!.mockResolvedValue([{ userId: 'u1' }]);
      notificationsRepository.create!.mockImplementation(
        (v: Partial<Notification>) => v,
      );
      notificationsRepository.save!.mockImplementation(
        (v: Partial<Notification>[]) => v,
      );

      await service.notifyNewAlert({
        id: 'al4',
        coldRoomId: 'c1',
        type: AlertType.DEVICE_FAULT,
        triggerValue: null,
        details: { kind: 'fan_power', fanVoltage: 0, fault },
      } as unknown as Alert);

      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ body }),
      );
    });

    it('opens the body with the warehouse and room', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({
        id: 'c1',
        name: 'Phòng mát 01',
        warehouseId: 'w1',
        warehouse: { name: 'Hà Nội' },
      });
      warehouseStaffRepository.find!.mockResolvedValue([{ userId: 'u1' }]);
      notificationsRepository.create!.mockImplementation(
        (v: Partial<Notification>) => v,
      );

      await service.notifyNewAlert({
        id: 'al6',
        coldRoomId: 'c1',
        type: AlertType.OFFLINE,
        triggerValue: null,
      } as unknown as Alert);

      expect(coldRoomsRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'c1' },
        relations: { warehouse: true },
      });
      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Thiết bị mất kết nối',
          body: 'Kho Hà Nội › Phòng mát 01\nXem chi tiết trong ứng dụng.',
        }),
      );
    });

    it('says how long the door has been open', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({
        id: 'c1',
        warehouseId: 'w1',
      });
      warehouseStaffRepository.find!.mockResolvedValue([{ userId: 'u1' }]);
      notificationsRepository.create!.mockImplementation(
        (v: Partial<Notification>) => v,
      );
      notificationsRepository.save!.mockImplementation(
        (v: Partial<Notification>[]) => v,
      );

      await service.notifyNewAlert({
        id: 'al5',
        coldRoomId: 'c1',
        type: AlertType.DOOR_OPEN_TOO_LONG,
        triggerValue: null,
        details: { openSeconds: 20, maxSeconds: 15 },
      } as unknown as Alert);

      expect(notificationsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Cửa kho mở quá lâu',
          body: 'Cửa đã mở 20 giây (cho phép 15 giây).',
        }),
      );
    });
  });

  describe('findAll', () => {
    it('scopes to the given userId', async () => {
      notificationsRepository.findAndCount!.mockResolvedValue([[], 0]);

      await service.findAll('u1', {});

      expect(notificationsRepository.findAndCount).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 0,
        take: 20,
      });
    });

    it('shows Staff only alerts of the warehouses they are on shift at', async () => {
      notificationsRepository.findAndCount!.mockResolvedValue([[], 0]);
      (
        usersRepository as unknown as { manager: { find: jest.Mock } }
      ).manager.find.mockResolvedValue([{ warehouseId: 'w1' }]);

      await service.findAll('u1', {}, UserRole.STAFF);

      expect(notificationsRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            { userId: 'u1', alertId: IsNull() },
            { userId: 'u1', alert: { coldRoom: { warehouseId: In(['w1']) } } },
          ],
        }),
      );
    });

    it('shows off-shift Staff no alert notifications at all', async () => {
      notificationsRepository.findAndCount!.mockResolvedValue([[], 0]);

      await service.findAll('u1', {}, UserRole.STAFF);

      expect(notificationsRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', alertId: IsNull() } }),
      );
    });

    it('adds an unread filter only when unreadOnly=true', async () => {
      notificationsRepository.findAndCount!.mockResolvedValue([[], 0]);

      await service.findAll('u1', { unreadOnly: 'true' });

      expect(notificationsRepository.findAndCount).toHaveBeenCalledWith({
        where: { userId: 'u1', readAt: IsNull() },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: 0,
        take: 20,
      });
    });
  });

  describe('markRead', () => {
    it('throws NotFoundException when the id does not belong to userId (or does not exist)', async () => {
      notificationsRepository.update!.mockResolvedValue({ affected: 0 });

      await expect(service.markRead('n1', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('stamps read_at scoped to (id, userId)', async () => {
      notificationsRepository.update!.mockResolvedValue({ affected: 1 });
      notificationsRepository.findOne!.mockResolvedValue({
        id: 'n1',
        readAt: new Date(),
      });

      await service.markRead('n1', 'u1');

      const [criteria, patch] = notificationsRepository.update!.mock
        .calls[0] as [unknown, { readAt: Date }];
      expect(criteria).toEqual({ id: 'n1', userId: 'u1' });
      expect(patch.readAt).toBeInstanceOf(Date);
    });
  });
});
