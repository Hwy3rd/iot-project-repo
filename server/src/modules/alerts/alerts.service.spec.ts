import { ConflictException, NotFoundException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { AlertStatus, AlertType } from '../../libs/constants/alert.constant';
import { QUEUE_NAMES } from '../../libs/constants/queue.constant';
import { AlertsService } from './alerts.service';
import { Alert } from './entities/alert.entity';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
});

const duplicateKeyError = () =>
  new QueryFailedError('INSERT ...', [], {
    name: 'Error',
    message: 'Duplicate entry',
    code: 'ER_DUP_ENTRY',
  } as unknown as Error);

describe('AlertsService', () => {
  let service: AlertsService;
  let alertsRepository: MockRepository<Alert>;
  let notificationsQueue: { add: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        {
          provide: getRepositoryToken(Alert),
          useValue: createMockRepository<Alert>(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.ALERT_NOTIFICATIONS),
          useValue: { add: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(AlertsService);
    alertsRepository = module.get(getRepositoryToken(Alert));
    notificationsQueue = module.get(
      getQueueToken(QUEUE_NAMES.ALERT_NOTIFICATIONS),
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('raise', () => {
    const input = {
      coldRoomId: 'c1',
      deviceId: 'd1',
      type: AlertType.TEMPERATURE_OUT_OF_RANGE,
      triggerValue: -10,
      threshold: -15,
      details: { direction: 'high' as const },
    };

    it('throws when neither deviceId nor batchId is given', async () => {
      await expect(
        service.raise({ ...input, deviceId: undefined }),
      ).rejects.toThrow('raise() requires deviceId or batchId');
      expect(alertsRepository.create).not.toHaveBeenCalled();
    });

    it('creates a new open alert keyed by type + subject', async () => {
      alertsRepository.create!.mockImplementation((v: Partial<Alert>) => v);
      alertsRepository.save!.mockImplementation((v: Partial<Alert>) => ({
        id: 'a1',
        ...v,
      }));

      const result = await service.raise(input);

      expect(alertsRepository.create).toHaveBeenCalledWith({
        coldRoomId: 'c1',
        deviceId: 'd1',
        batchId: null,
        type: AlertType.TEMPERATURE_OUT_OF_RANGE,
        status: AlertStatus.OPEN,
        activeKey: 'temperature_out_of_range:d1',
        triggerValue: -10,
        threshold: -15,
        details: { direction: 'high' },
      });
      expect(result).toMatchObject({
        id: 'a1',
        activeKey: 'temperature_out_of_range:d1',
      });
      // A genuinely new alert enqueues a notification job for it.
      expect(notificationsQueue.add).toHaveBeenCalledWith('notify', {
        alertId: 'a1',
      });
    });

    it('does not fail raise() when enqueueing the notification job fails', async () => {
      alertsRepository.create!.mockImplementation((v: Partial<Alert>) => v);
      alertsRepository.save!.mockImplementation((v: Partial<Alert>) => ({
        id: 'a1',
        ...v,
      }));
      notificationsQueue.add.mockRejectedValue(new Error('redis down'));

      await expect(service.raise(input)).resolves.toMatchObject({ id: 'a1' });
    });

    it('refreshes the existing alert instead of creating a duplicate on a collision', async () => {
      alertsRepository.create!.mockImplementation((v: Partial<Alert>) => v);
      alertsRepository
        .save!.mockRejectedValueOnce(duplicateKeyError())
        .mockImplementation((v: Partial<Alert>) => v);
      const existing = {
        id: 'a1',
        activeKey: 'temperature_out_of_range:d1',
        triggerValue: -10,
        details: { direction: 'high' },
      };
      alertsRepository.findOne!.mockResolvedValue(existing);

      const result = await service.raise({ ...input, triggerValue: -12 });

      expect(alertsRepository.findOne).toHaveBeenCalledWith({
        where: { activeKey: 'temperature_out_of_range:d1' },
      });
      expect(existing.triggerValue).toBe(-12);
      // save() is called again with the mutated existing row, not create().
      expect(alertsRepository.save).toHaveBeenCalledTimes(2);
      expect(alertsRepository.save).toHaveBeenLastCalledWith(existing);
      expect(result).toBe(existing);
      // A refresh of an already-open incident must not re-notify.
      expect(notificationsQueue.add).not.toHaveBeenCalled();
    });

    it('rethrows a non-duplicate-key write error', async () => {
      alertsRepository.create!.mockImplementation((v: Partial<Alert>) => v);
      alertsRepository.save!.mockRejectedValue(new Error('connection lost'));

      await expect(service.raise(input)).rejects.toThrow('connection lost');
      expect(alertsRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('resolveAuto', () => {
    it('throws when neither deviceId nor batchId is given', async () => {
      await expect(
        service.resolveAuto({ type: AlertType.OFFLINE }),
      ).rejects.toThrow('resolveAuto() requires deviceId or batchId');
    });

    it('is a no-op (does not throw) when nothing is open for the incident', async () => {
      alertsRepository.update!.mockResolvedValue({ affected: 0 });

      await expect(
        service.resolveAuto({ type: AlertType.OFFLINE, deviceId: 'd1' }),
      ).resolves.toBeUndefined();
    });

    it('resolves the open alert and clears active_key', async () => {
      alertsRepository.update!.mockResolvedValue({ affected: 1 });

      await service.resolveAuto({
        type: AlertType.TEMPERATURE_OUT_OF_RANGE,
        deviceId: 'd1',
      });

      expect(alertsRepository.update).toHaveBeenCalledWith(
        { activeKey: 'temperature_out_of_range:d1' },
        expect.objectContaining({
          status: AlertStatus.RESOLVED,
          resolution: 'auto',
          activeKey: null,
        }),
      );
    });
  });

  describe('acknowledge', () => {
    it('records the given actor as acknowledgedBy', async () => {
      alertsRepository.update!.mockResolvedValue({ affected: 1 });
      alertsRepository.findOne!.mockResolvedValue({
        id: 'a1',
        status: AlertStatus.ACKNOWLEDGED,
      });

      await service.acknowledge('a1', 'u1');

      expect(alertsRepository.update).toHaveBeenCalledWith(
        { id: 'a1', status: AlertStatus.OPEN },
        expect.objectContaining({ acknowledgedBy: 'u1' }),
      );
    });

    it('acknowledges without an actor for an automated caller', async () => {
      alertsRepository.update!.mockResolvedValue({ affected: 1 });
      alertsRepository.findOne!.mockResolvedValue({
        id: 'a1',
        status: AlertStatus.ACKNOWLEDGED,
      });

      await service.acknowledge('a1');

      expect(alertsRepository.update).toHaveBeenCalledWith(
        { id: 'a1', status: AlertStatus.OPEN },
        expect.objectContaining({
          status: AlertStatus.ACKNOWLEDGED,
          acknowledgedBy: null,
        }),
      );
    });

    it('throws ConflictException without a second write when the alert is not open (race)', async () => {
      alertsRepository.update!.mockResolvedValue({ affected: 0 });
      alertsRepository.findOne!.mockResolvedValue({
        id: 'a1',
        status: AlertStatus.RESOLVED,
      });

      await expect(service.acknowledge('a1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when the alert id does not exist at all', async () => {
      alertsRepository.update!.mockResolvedValue({ affected: 0 });
      alertsRepository.findOne!.mockResolvedValue(null);

      await expect(service.acknowledge('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resolveManual', () => {
    it('resolves from either open or acknowledged, clearing active_key', async () => {
      alertsRepository.update!.mockResolvedValue({ affected: 1 });
      alertsRepository.findOne!.mockResolvedValue({
        id: 'a1',
        status: AlertStatus.RESOLVED,
      });

      await service.resolveManual('a1', 'u1');

      expect(alertsRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a1' }),
        expect.objectContaining({
          status: AlertStatus.RESOLVED,
          resolvedBy: 'u1',
          resolution: 'manual',
          activeKey: null,
        }),
      );
    });

    it('throws ConflictException when already resolved', async () => {
      alertsRepository.update!.mockResolvedValue({ affected: 0 });
      alertsRepository.findOne!.mockResolvedValue({
        id: 'a1',
        status: AlertStatus.RESOLVED,
      });

      await expect(service.resolveManual('a1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('filters by the provided query fields only', async () => {
      alertsRepository.find!.mockResolvedValue([]);

      await service.findAll({ status: AlertStatus.OPEN, coldRoomId: 'c1' });

      expect(alertsRepository.find).toHaveBeenCalledWith({
        where: { status: AlertStatus.OPEN, coldRoomId: 'c1' },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the alert does not exist', async () => {
      alertsRepository.findOne!.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
