import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ShiftType } from '../../libs/constants/shift.constant';
import { Shift } from './entities/shift.entity';
import { ShiftsService } from './shifts.service';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  softDelete: jest.fn(),
});

describe('ShiftsService', () => {
  let service: ShiftsService;
  let shiftsRepository: MockRepository<Shift>;

  const dto = {
    shiftType: ShiftType.MORNING,
    startTime: '06:00',
    endTime: '14:00',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShiftsService,
        {
          provide: getRepositoryToken(Shift),
          useValue: createMockRepository<Shift>(),
        },
      ],
    }).compile();

    service = module.get<ShiftsService>(ShiftsService);
    shiftsRepository = module.get(getRepositoryToken(Shift));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('converts a duplicate shift_type into ConflictException', async () => {
      shiftsRepository.create!.mockReturnValue(dto);
      shiftsRepository.save!.mockRejectedValue(
        new QueryFailedError('INSERT ...', [], {
          name: 'Error',
          message: 'Duplicate entry',
          code: 'ER_DUP_ENTRY',
        } as unknown as Error),
      );

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('creates the shift template', async () => {
      shiftsRepository.create!.mockImplementation((v: Partial<Shift>) => v);
      shiftsRepository.save!.mockImplementation((v: Partial<Shift>) => ({
        id: 's1',
        ...v,
      }));

      const result = await service.create(dto);

      expect(result).toMatchObject({ id: 's1', shiftType: ShiftType.MORNING });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the shift does not exist', async () => {
      shiftsRepository.findOne!.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      shiftsRepository.softDelete!.mockResolvedValue({ affected: 0 });

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes the shift', async () => {
      shiftsRepository.softDelete!.mockResolvedValue({ affected: 1 });

      await expect(service.remove('s1')).resolves.toBeUndefined();
    });
  });
});
