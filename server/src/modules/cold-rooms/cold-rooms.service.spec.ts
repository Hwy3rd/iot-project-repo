import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { ColdRoomsService } from './cold-rooms.service';
import { ColdRoom } from './entities/cold-room.entity';

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

describe('ColdRoomsService', () => {
  let service: ColdRoomsService;
  let coldRoomsRepository: MockRepository<ColdRoom>;
  let warehousesRepository: MockRepository<Warehouse>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ColdRoomsService,
        {
          provide: getRepositoryToken(ColdRoom),
          useValue: createMockRepository<ColdRoom>(),
        },
        {
          provide: getRepositoryToken(Warehouse),
          useValue: createMockRepository<Warehouse>(),
        },
      ],
    }).compile();

    service = module.get<ColdRoomsService>(ColdRoomsService);
    coldRoomsRepository = module.get(getRepositoryToken(ColdRoom));
    warehousesRepository = module.get(getRepositoryToken(Warehouse));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const dto = {
      warehouseId: 'w1',
      name: 'Room A',
      tempMin: -20,
      tempMax: -15,
    };

    it('throws BadRequestException when temp_min >= temp_max', async () => {
      await expect(
        service.create({ ...dto, tempMin: -10, tempMax: -15 }),
      ).rejects.toThrow(BadRequestException);
      expect(warehousesRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the warehouse does not exist', async () => {
      warehousesRepository.findOne!.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('converts a duplicate name within the warehouse into ConflictException', async () => {
      warehousesRepository.findOne!.mockResolvedValue({ id: 'w1' });
      coldRoomsRepository.create!.mockReturnValue(dto);
      coldRoomsRepository.save!.mockRejectedValue(
        new QueryFailedError('INSERT ...', [], {
          name: 'Error',
          message: 'Duplicate entry',
          code: 'ER_DUP_ENTRY',
        } as unknown as Error),
      );

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('creates the cold room', async () => {
      warehousesRepository.findOne!.mockResolvedValue({ id: 'w1' });
      coldRoomsRepository.create!.mockReturnValue(dto);
      coldRoomsRepository.save!.mockResolvedValue({ id: 'c1', ...dto });

      const result = await service.create(dto);

      expect(coldRoomsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining(dto),
      );
      expect(result).toEqual({ id: 'c1', ...dto });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the cold room does not exist', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the cold room does not exist', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue(null);

      await expect(service.update('missing-id', { name: 'B' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the merged range is invalid', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({
        id: 'c1',
        tempMin: -20,
        tempMax: -15,
      });

      await expect(service.update('c1', { tempMin: -10 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      coldRoomsRepository.softDelete!.mockResolvedValue({ affected: 0 });

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes the cold room', async () => {
      coldRoomsRepository.softDelete!.mockResolvedValue({ affected: 1 });

      await expect(service.remove('c1')).resolves.toBeUndefined();
      expect(coldRoomsRepository.softDelete).toHaveBeenCalledWith('c1');
    });
  });
});
