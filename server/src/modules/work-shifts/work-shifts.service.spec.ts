import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Paginated } from '../../common/pagination/paginated';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  In,
  IsNull,
  MoreThan,
  MoreThanOrEqual,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { WorkShiftStatus } from '../../libs/constants/work-shift.constant';
import { Shift } from '../shifts/entities/shift.entity';
import { User } from '../users/entities/user.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { WorkShift } from './entities/work-shift.entity';
import { UserRole } from '../../libs/constants/user.constant';
import { WorkShiftsService } from './work-shifts.service';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  existsBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
});

describe('WorkShiftsService', () => {
  let service: WorkShiftsService;
  let workShiftsRepository: MockRepository<WorkShift>;
  let shiftsRepository: MockRepository<Shift>;
  let usersRepository: MockRepository<User>;
  let warehouseStaffRepository: MockRepository<WarehouseStaff>;

  const realtime = { emitToUser: jest.fn() };

  // Business timezone is UTC+7: 08:00 there on 2026-09-25.
  const now = new Date('2026-09-25T01:00:00Z');
  const morning = {
    id: 'sh-m',
    name: 'Ca sáng',
    startTime: '06:00:00',
    endTime: '14:00:00',
  } as Shift;
  const night = {
    id: 'sh-n',
    name: 'Ca tối',
    startTime: '22:00:00',
    endTime: '06:00:00',
  } as Shift;
  const morningSchedule = {
    shiftId: 'sh-m',
    workDate: '2026-09-25',
    scheduledStartAt: new Date('2026-09-24T23:00:00Z'),
    scheduledEndAt: new Date('2026-09-25T07:00:00Z'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkShiftsService,
        {
          provide: getRepositoryToken(WorkShift),
          useValue: createMockRepository<WorkShift>(),
        },
        {
          provide: getRepositoryToken(Shift),
          useValue: createMockRepository<Shift>(),
        },
        {
          provide: getRepositoryToken(User),
          useValue: createMockRepository<User>(),
        },
        {
          provide: getRepositoryToken(WarehouseStaff),
          useValue: createMockRepository<WarehouseStaff>(),
        },
        { provide: RealtimeGateway, useValue: realtime },
      ],
    }).compile();

    service = module.get<WorkShiftsService>(WorkShiftsService);
    workShiftsRepository = module.get(getRepositoryToken(WorkShift));
    shiftsRepository = module.get(getRepositoryToken(Shift));
    jest.clearAllMocks();
    usersRepository = module.get(getRepositoryToken(User));
    warehouseStaffRepository = module.get(getRepositoryToken(WarehouseStaff));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('is unfiltered for an admin', async () => {
      workShiftsRepository.findAndCount!.mockResolvedValue([[], 0]);

      await service.findAll({
        userId: 'a1',
        role: UserRole.ADMIN,
        warehouseIds: null,
        staffWarehouseIds: [],
      });

      expect(workShiftsRepository.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { scheduledStartAt: 'DESC', id: 'DESC' },
        skip: 0,
        take: 20,
      });
    });

    it('returns all shifts where the caller manages, only their own where they are Staff', async () => {
      workShiftsRepository.findAndCount!.mockResolvedValue([[], 0]);

      await service.findAll({
        userId: 'u1',
        role: UserRole.MANAGER,
        warehouseIds: ['w1', 'w2'],
        staffWarehouseIds: ['w2'],
      });

      expect(workShiftsRepository.findAndCount).toHaveBeenCalledWith({
        where: [
          { warehouseId: In(['w1']) },
          { warehouseId: In(['w2']), staffId: 'u1' },
        ],
        order: { scheduledStartAt: 'DESC', id: 'DESC' },
        skip: 0,
        take: 20,
      });
    });

    it('applies filters to every scope branch and narrows by warehouseId', async () => {
      workShiftsRepository.findAndCount!.mockResolvedValue([[], 0]);

      await service.findAll(
        {
          userId: 'u1',
          role: UserRole.MANAGER,
          warehouseIds: ['w1', 'w2', 'w3'],
          staffWarehouseIds: ['w2', 'w3'],
        },
        { warehouseId: 'w2', status: WorkShiftStatus.PENDING },
      );

      expect(workShiftsRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: [
            {
              status: WorkShiftStatus.PENDING,
              warehouseId: In(['w2']),
              staffId: 'u1',
            },
          ],
        }),
      );
    });

    it("finds nothing when Staff asks for someone else's shifts", async () => {
      await expect(
        service.findAll(
          {
            userId: 'u1',
            role: UserRole.STAFF,
            warehouseIds: ['w1'],
            staffWarehouseIds: ['w1'],
          },
          { staffId: 'u2' },
        ),
      ).resolves.toEqual(Paginated.empty());
      expect(workShiftsRepository.findAndCount).not.toHaveBeenCalled();
    });

    it('filters an admin by warehouse and work date range', async () => {
      workShiftsRepository.findAndCount!.mockResolvedValue([[], 0]);

      await service.findAll(
        {
          userId: 'a1',
          role: UserRole.ADMIN,
          warehouseIds: null,
          staffWarehouseIds: [],
        },
        { warehouseId: 'w1', workDateFrom: '2026-09-01' },
      );

      expect(workShiftsRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { warehouseId: 'w1', workDate: MoreThanOrEqual('2026-09-01') },
        }),
      );
    });

    it('returns nothing without any readable warehouse', async () => {
      await expect(
        service.findAll({
          userId: 'u1',
          role: UserRole.STAFF,
          warehouseIds: [],
          staffWarehouseIds: [],
        }),
      ).resolves.toEqual(Paginated.empty());
      expect(workShiftsRepository.findAndCount).not.toHaveBeenCalled();
    });
  });

  describe('attendance', () => {
    it('returns the active shift, the open shift, the request for it and the Staff warehouses', async () => {
      const active = { id: 'ws-night', status: WorkShiftStatus.APPROVED };
      const request = { id: 'ws-1', status: WorkShiftStatus.PENDING };
      workShiftsRepository
        .findOne!.mockResolvedValueOnce(active)
        .mockResolvedValueOnce(request);
      shiftsRepository.find!.mockResolvedValue([morning, night]);
      warehouseStaffRepository.find!.mockResolvedValue([
        { warehouse: { id: 'w1', name: 'Kho 1', code: 'K1', address: 'x' } },
        { warehouse: null },
      ]);

      const result = await service.attendance('u1', now);

      expect(workShiftsRepository.findOne).toHaveBeenNthCalledWith(1, {
        where: {
          staffId: 'u1',
          status: WorkShiftStatus.APPROVED,
          checkOutAt: IsNull(),
          scheduledEndAt: MoreThan(new Date('2026-09-25T00:55:00Z')),
        },
        order: { scheduledStartAt: 'DESC' },
      });
      expect(workShiftsRepository.findOne).toHaveBeenNthCalledWith(2, {
        where: { staffId: 'u1', shiftId: 'sh-m', workDate: '2026-09-25' },
      });
      expect(warehouseStaffRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', user: { role: UserRole.STAFF } },
        }),
      );
      expect(result).toEqual({
        active,
        open: { ...morningSchedule, name: 'Ca sáng' },
        request,
        warehouses: [{ id: 'w1', name: 'Kho 1', code: 'K1' }],
      });
    });

    it('has no open shift and no request between shifts', async () => {
      workShiftsRepository.findOne!.mockResolvedValue(null);
      shiftsRepository.find!.mockResolvedValue([morning]);
      warehouseStaffRepository.find!.mockResolvedValue([]);

      // 20:00 in the business timezone.
      const result = await service.attendance(
        'u1',
        new Date('2026-09-25T13:00:00Z'),
      );

      expect(result.open).toBeNull();
      expect(result.request).toBeNull();
      expect(workShiftsRepository.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('checkIn', () => {
    beforeEach(() => {
      warehouseStaffRepository.existsBy!.mockResolvedValue(true);
      shiftsRepository.find!.mockResolvedValue([morning, night]);
      workShiftsRepository.create!.mockImplementation(
        (value: object) => ({ ...value }) as WorkShift,
      );
      workShiftsRepository.save!.mockImplementation((value: WorkShift) =>
        Promise.resolve({ ...value, id: 'ws-1' }),
      );
      warehouseStaffRepository.find!.mockResolvedValue([{ userId: 'm1' }]);
      usersRepository.find!.mockResolvedValue([{ id: 'a1' }]);
    });

    it('refuses a caller who is not Staff of the warehouse', async () => {
      warehouseStaffRepository.existsBy!.mockResolvedValue(false);

      await expect(service.checkIn('u1', 'w1', now)).rejects.toThrow(
        BadRequestException,
      );
      expect(warehouseStaffRepository.existsBy).toHaveBeenCalledWith({
        userId: 'u1',
        warehouseId: 'w1',
        user: { role: UserRole.STAFF },
      });
    });

    it('refuses when no shift is open', async () => {
      shiftsRepository.find!.mockResolvedValue([night]);

      await expect(service.checkIn('u1', 'w1', now)).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates a pending request for the open shift and announces it', async () => {
      workShiftsRepository.findOne!.mockResolvedValue(null);

      const result = await service.checkIn('u1', 'w1', now);

      expect(result).toEqual(
        expect.objectContaining({
          ...morningSchedule,
          staffId: 'u1',
          warehouseId: 'w1',
          status: WorkShiftStatus.PENDING,
          checkInAt: now,
        }),
      );
      const event = {
        workShiftId: 'ws-1',
        warehouseId: 'w1',
        staffId: 'u1',
        status: WorkShiftStatus.PENDING,
        // `now` is 2 hours into the morning shift.
        lateMinutes: 120,
      };
      expect(warehouseStaffRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { warehouseId: 'w1', user: { role: UserRole.MANAGER } },
        }),
      );
      for (const userId of ['u1', 'm1', 'a1']) {
        expect(realtime.emitToUser).toHaveBeenCalledWith(
          userId,
          'workshift:changed',
          event,
        );
      }
    });

    it.each([WorkShiftStatus.PENDING, WorkShiftStatus.APPROVED])(
      'refuses a second request while one is %s',
      async (status) => {
        workShiftsRepository.findOne!.mockResolvedValue({ id: 'ws-1', status });

        await expect(service.checkIn('u1', 'w1', now)).rejects.toThrow(
          ConflictException,
        );
        expect(workShiftsRepository.save).not.toHaveBeenCalled();
      },
    );

    it('re-sends a rejected request on the same row, clearing the review', async () => {
      workShiftsRepository.findOne!.mockResolvedValue({
        id: 'ws-1',
        staffId: 'u1',
        warehouseId: 'w2',
        status: WorkShiftStatus.REJECTED,
        reviewedBy: 'm1',
        reviewedAt: new Date(),
        rejectReason: 'Sai kho',
      });

      await service.checkIn('u1', 'w1', now);

      expect(workShiftsRepository.create).not.toHaveBeenCalled();
      expect(workShiftsRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ws-1',
          warehouseId: 'w1',
          status: WorkShiftStatus.PENDING,
          reviewedBy: null,
          reviewedAt: null,
          rejectReason: null,
        }),
      );
    });

    it('converts a duplicate (staff, work_date, shift) race into ConflictException', async () => {
      workShiftsRepository.findOne!.mockResolvedValue(null);
      const duplicate = new QueryFailedError('INSERT', [], new Error('dup'));
      (duplicate as unknown as { code: string }).code = 'ER_DUP_ENTRY';
      workShiftsRepository.save!.mockRejectedValue(duplicate);

      await expect(service.checkIn('u1', 'w1', now)).rejects.toThrow(
        ConflictException,
      );
    });

    it('still succeeds when announcing fails', async () => {
      workShiftsRepository.findOne!.mockResolvedValue(null);
      usersRepository.find!.mockRejectedValue(new Error('db down'));

      await expect(service.checkIn('u1', 'w1', now)).resolves.toBeDefined();
    });
  });

  describe('approve / reject', () => {
    const pending = () => ({
      id: 'ws-1',
      staffId: 'u1',
      warehouseId: 'w1',
      status: WorkShiftStatus.PENDING,
      scheduledEndAt: morningSchedule.scheduledEndAt,
    });

    beforeEach(() => {
      workShiftsRepository.save!.mockImplementation((value: WorkShift) =>
        Promise.resolve(value),
      );
      warehouseStaffRepository.find!.mockResolvedValue([]);
      usersRepository.find!.mockResolvedValue([]);
    });

    it('throws NotFoundException when the work shift does not exist', async () => {
      workShiftsRepository.findOne!.mockResolvedValue(null);

      await expect(service.approve('x', 'm1', now)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('approves a pending request and records the reviewer', async () => {
      workShiftsRepository.findOne!.mockResolvedValue(pending());

      const result = await service.approve('ws-1', 'm1', now);

      expect(result).toEqual(
        expect.objectContaining({
          status: WorkShiftStatus.APPROVED,
          reviewedBy: 'm1',
          reviewedAt: now,
        }),
      );
      expect(realtime.emitToUser).toHaveBeenCalledWith(
        'u1',
        'workshift:changed',
        expect.objectContaining({ status: WorkShiftStatus.APPROVED }),
      );
    });

    it('refuses to approve once the shift has ended', async () => {
      workShiftsRepository.findOne!.mockResolvedValue(pending());

      await expect(
        service.approve('ws-1', 'm1', new Date('2026-09-25T07:00:00Z')),
      ).rejects.toThrow(ConflictException);
    });

    it.each([
      WorkShiftStatus.APPROVED,
      WorkShiftStatus.REJECTED,
      WorkShiftStatus.EXPIRED,
    ])('refuses to review a %s request', async (status) => {
      workShiftsRepository.findOne!.mockResolvedValue({ ...pending(), status });

      await expect(service.approve('ws-1', 'm1', now)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.reject('ws-1', 'm1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects with a trimmed reason, or none', async () => {
      workShiftsRepository.findOne!.mockResolvedValueOnce(pending());
      await expect(service.reject('ws-1', 'm1', '  Sai kho ')).resolves.toEqual(
        expect.objectContaining({
          status: WorkShiftStatus.REJECTED,
          reviewedBy: 'm1',
          rejectReason: 'Sai kho',
        }),
      );

      workShiftsRepository.findOne!.mockResolvedValueOnce(pending());
      await expect(service.reject('ws-1', 'm1', '   ')).resolves.toEqual(
        expect.objectContaining({ rejectReason: null }),
      );
    });
  });

  describe('checkOut', () => {
    beforeEach(() => {
      workShiftsRepository.save!.mockImplementation((value: WorkShift) =>
        Promise.resolve(value),
      );
      warehouseStaffRepository.find!.mockResolvedValue([]);
      usersRepository.find!.mockResolvedValue([]);
    });

    it('throws ConflictException unless the shift is approved and in progress', async () => {
      workShiftsRepository.findOne!.mockResolvedValue({
        id: '1',
        status: WorkShiftStatus.PENDING,
        checkOutAt: null,
      });
      await expect(service.checkOut('1')).rejects.toThrow(ConflictException);

      workShiftsRepository.findOne!.mockResolvedValue({
        id: '1',
        status: WorkShiftStatus.APPROVED,
        checkOutAt: new Date(),
      });
      await expect(service.checkOut('1')).rejects.toThrow(ConflictException);
    });

    it('sets check_out_at', async () => {
      workShiftsRepository.findOne!.mockResolvedValue({
        id: '1',
        status: WorkShiftStatus.APPROVED,
        checkOutAt: null,
      });

      const result = await service.checkOut('1');

      expect(result.checkOutAt).toBeInstanceOf(Date);
      expect(result.status).toBe(WorkShiftStatus.APPROVED);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      workShiftsRepository.delete!.mockResolvedValue({ affected: 0 });

      await expect(service.remove('1')).rejects.toThrow(NotFoundException);
    });

    it('deletes the work shift', async () => {
      workShiftsRepository.delete!.mockResolvedValue({ affected: 1 });

      await service.remove('1');

      expect(workShiftsRepository.delete).toHaveBeenCalledWith('1');
    });
  });
});
