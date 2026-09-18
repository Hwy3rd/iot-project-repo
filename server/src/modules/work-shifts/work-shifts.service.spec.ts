import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { WorkShiftStatus } from '../../libs/constants/work-shift.constant';
import { Shift } from '../shifts/entities/shift.entity';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { WorkShift } from './entities/work-shift.entity';
import { WorkShiftsService } from './work-shifts.service';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
});

describe('WorkShiftsService', () => {
  let service: WorkShiftsService;
  let workShiftsRepository: MockRepository<WorkShift>;
  let shiftsRepository: MockRepository<Shift>;
  let warehousesRepository: MockRepository<Warehouse>;
  let usersRepository: MockRepository<User>;
  let warehouseStaffRepository: MockRepository<WarehouseStaff>;

  const dto = {
    shiftId: 'sh1',
    staffId: 'u1',
    warehouseId: 'w1',
    workDate: '2026-01-01',
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
          provide: getRepositoryToken(Warehouse),
          useValue: createMockRepository<Warehouse>(),
        },
        {
          provide: getRepositoryToken(User),
          useValue: createMockRepository<User>(),
        },
        {
          provide: getRepositoryToken(WarehouseStaff),
          useValue: createMockRepository<WarehouseStaff>(),
        },
      ],
    }).compile();

    service = module.get<WorkShiftsService>(WorkShiftsService);
    workShiftsRepository = module.get(getRepositoryToken(WorkShift));
    shiftsRepository = module.get(getRepositoryToken(Shift));
    warehousesRepository = module.get(getRepositoryToken(Warehouse));
    usersRepository = module.get(getRepositoryToken(User));
    warehouseStaffRepository = module.get(getRepositoryToken(WarehouseStaff));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('throws NotFoundException when the warehouse does not exist', async () => {
      warehousesRepository.findOne!.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the staff does not exist', async () => {
      warehousesRepository.findOne!.mockResolvedValue({ id: 'w1' });
      usersRepository.findOne!.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the staff is not assigned to the warehouse', async () => {
      warehousesRepository.findOne!.mockResolvedValue({ id: 'w1' });
      usersRepository.findOne!.mockResolvedValue({ id: 'u1' });
      warehouseStaffRepository.findOne!.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the shift template does not exist', async () => {
      warehousesRepository.findOne!.mockResolvedValue({ id: 'w1' });
      usersRepository.findOne!.mockResolvedValue({ id: 'u1' });
      warehouseStaffRepository.findOne!.mockResolvedValue({
        userId: 'u1',
        warehouseId: 'w1',
      });
      shiftsRepository.findOne!.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('converts a duplicate (staff, work_date, shift) into ConflictException', async () => {
      warehousesRepository.findOne!.mockResolvedValue({ id: 'w1' });
      usersRepository.findOne!.mockResolvedValue({ id: 'u1' });
      warehouseStaffRepository.findOne!.mockResolvedValue({
        userId: 'u1',
        warehouseId: 'w1',
      });
      shiftsRepository.findOne!.mockResolvedValue({
        id: 'sh1',
        startTime: '06:00:00',
        endTime: '14:00:00',
      });
      workShiftsRepository.create!.mockImplementation(
        (v: Partial<WorkShift>) => v,
      );
      workShiftsRepository.save!.mockRejectedValue(
        new QueryFailedError('INSERT ...', [], {
          name: 'Error',
          message: 'Duplicate entry',
          code: 'ER_DUP_ENTRY',
        } as unknown as Error),
      );

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('creates the work shift with a computed schedule', async () => {
      warehousesRepository.findOne!.mockResolvedValue({ id: 'w1' });
      usersRepository.findOne!.mockResolvedValue({ id: 'u1' });
      warehouseStaffRepository.findOne!.mockResolvedValue({
        userId: 'u1',
        warehouseId: 'w1',
      });
      shiftsRepository.findOne!.mockResolvedValue({
        id: 'sh1',
        startTime: '06:00:00',
        endTime: '14:00:00',
      });
      workShiftsRepository.create!.mockImplementation(
        (v: Partial<WorkShift>) => v,
      );
      workShiftsRepository.save!.mockImplementation(
        (v: Partial<WorkShift>) => ({
          id: 'ws1',
          ...v,
        }),
      );

      const result = await service.create(dto);

      expect(result).toMatchObject({
        id: 'ws1',
        status: WorkShiftStatus.SCHEDULED,
      });
      expect(result.scheduledStartAt.toISOString()).toBe(
        '2026-01-01T06:00:00.000Z',
      );
      expect(result.scheduledEndAt.toISOString()).toBe(
        '2026-01-01T14:00:00.000Z',
      );
    });

    it('rolls the scheduled end to the next day for an overnight shift', async () => {
      warehousesRepository.findOne!.mockResolvedValue({ id: 'w1' });
      usersRepository.findOne!.mockResolvedValue({ id: 'u1' });
      warehouseStaffRepository.findOne!.mockResolvedValue({
        userId: 'u1',
        warehouseId: 'w1',
      });
      shiftsRepository.findOne!.mockResolvedValue({
        id: 'sh1',
        startTime: '22:00:00',
        endTime: '06:00:00',
      });
      workShiftsRepository.create!.mockImplementation(
        (v: Partial<WorkShift>) => v,
      );
      workShiftsRepository.save!.mockImplementation(
        (v: Partial<WorkShift>) => v,
      );

      const result = await service.create(dto);

      expect(result.scheduledStartAt.toISOString()).toBe(
        '2026-01-01T22:00:00.000Z',
      );
      expect(result.scheduledEndAt.toISOString()).toBe(
        '2026-01-02T06:00:00.000Z',
      );
    });
  });

  describe('checkIn', () => {
    it('throws NotFoundException when the work shift does not exist', async () => {
      workShiftsRepository.findOne!.mockResolvedValue(null);

      await expect(service.checkIn('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the work shift is not scheduled', async () => {
      workShiftsRepository.findOne!.mockResolvedValue({
        id: 'ws1',
        status: WorkShiftStatus.COMPLETED,
      });

      await expect(service.checkIn('ws1')).rejects.toThrow(ConflictException);
    });

    it('sets check_in_at and status to checked_in', async () => {
      const workShift = {
        id: 'ws1',
        status: WorkShiftStatus.SCHEDULED,
        checkInAt: null,
      };
      workShiftsRepository.findOne!.mockResolvedValue(workShift);
      workShiftsRepository.save!.mockImplementation((v: WorkShift) => v);

      const result = await service.checkIn('ws1');

      expect(result.status).toBe(WorkShiftStatus.CHECKED_IN);
      expect(result.checkInAt).not.toBeNull();
    });
  });

  describe('checkOut', () => {
    it('throws ConflictException when the work shift is not checked in', async () => {
      workShiftsRepository.findOne!.mockResolvedValue({
        id: 'ws1',
        status: WorkShiftStatus.SCHEDULED,
      });

      await expect(service.checkOut('ws1')).rejects.toThrow(ConflictException);
    });

    it('sets check_out_at and status to completed', async () => {
      const workShift = {
        id: 'ws1',
        status: WorkShiftStatus.CHECKED_IN,
        checkOutAt: null,
      };
      workShiftsRepository.findOne!.mockResolvedValue(workShift);
      workShiftsRepository.save!.mockImplementation((v: WorkShift) => v);

      const result = await service.checkOut('ws1');

      expect(result.status).toBe(WorkShiftStatus.COMPLETED);
      expect(result.checkOutAt).not.toBeNull();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      workShiftsRepository.delete!.mockResolvedValue({ affected: 0 });

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes the work shift', async () => {
      workShiftsRepository.delete!.mockResolvedValue({ affected: 1 });

      await expect(service.remove('ws1')).resolves.toBeUndefined();
    });
  });
});
