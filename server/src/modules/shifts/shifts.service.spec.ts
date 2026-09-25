import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shift } from './entities/shift.entity';
import { ShiftsService } from './shifts.service';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  softDelete: jest.fn(),
});

const template = (
  id: string,
  name: string,
  startTime: string,
  endTime: string,
) => ({ id, name, startTime, endTime }) as Shift;

describe('ShiftsService', () => {
  let service: ShiftsService;
  let shiftsRepository: MockRepository<Shift>;

  const existing = [
    template('m', 'Ca sáng', '06:00:00', '14:00:00'),
    template('n', 'Ca tối', '22:00:00', '06:00:00'),
  ];

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
    shiftsRepository.create!.mockImplementation((v: Partial<Shift>) => ({
      ...v,
    }));
    shiftsRepository.save!.mockImplementation((v: Partial<Shift>) =>
      Promise.resolve({ id: 's1', ...v }),
    );
    shiftsRepository.find!.mockResolvedValue(existing);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a template filling a free slot, touching its neighbours', async () => {
      await expect(
        service.create({
          name: 'Ca chiều',
          startTime: '14:00',
          endTime: '22:00',
        }),
      ).resolves.toMatchObject({ id: 's1', name: 'Ca chiều' });
    });

    it.each([
      ['inside another', '08:00', '10:00'],
      ['across the start of another', '05:00', '07:00'],
      ['across midnight into the night shift', '23:00', '01:00'],
      ['containing the night shift', '21:00', '07:00'],
    ])('refuses hours %s', async (_, startTime, endTime) => {
      await expect(
        service.create({ name: 'Ca mới', startTime, endTime }),
      ).rejects.toThrow(ConflictException);
      expect(shiftsRepository.save).not.toHaveBeenCalled();
    });

    it('refuses a name already used, ignoring case', async () => {
      await expect(
        service.create({
          name: 'CA SÁNG',
          startTime: '14:00',
          endTime: '15:00',
        }),
      ).rejects.toThrow('already exists');
    });

    it('refuses equal start and end times', async () => {
      await expect(
        service.create({
          name: 'Ca 0',
          startTime: '15:00',
          endTime: '15:00:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('ignores the template itself when checking overlaps and name', async () => {
      shiftsRepository.findOne!.mockResolvedValue({ ...existing[0] });

      await expect(
        service.update('m', { name: 'Ca sáng', endTime: '15:00' }),
      ).resolves.toMatchObject({ endTime: '15:00' });
    });

    it('refuses new hours that overlap another template', async () => {
      shiftsRepository.findOne!.mockResolvedValue({ ...existing[0] });

      await expect(service.update('m', { startTime: '05:00' })).rejects.toThrow(
        'Overlaps shift template "Ca tối" (22:00-06:00)',
      );
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
