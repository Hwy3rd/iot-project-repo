import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, QueryFailedError, Repository } from 'typeorm';
import { AlertType } from '../../libs/constants/alert.constant';
import { NotificationStatus } from '../../libs/constants/notification.constant';
import { Alert } from '../alerts/entities/alert.entity';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { Notification } from './entities/notification.entity';
import { PushSubscription } from './entities/push-subscription.entity';
import { NotificationsService } from './notifications.service';

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
      ],
    }).compile();

    service = module.get(NotificationsService);
    subscriptionsRepository = module.get(getRepositoryToken(PushSubscription));
    notificationsRepository = module.get(getRepositoryToken(Notification));
    coldRoomsRepository = module.get(getRepositoryToken(ColdRoom));
    warehouseStaffRepository = module.get(getRepositoryToken(WarehouseStaff));
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

    it('returns [] when nobody is assigned to the warehouse', async () => {
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
