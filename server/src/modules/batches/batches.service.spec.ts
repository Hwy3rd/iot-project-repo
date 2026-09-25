import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { BatchStatus } from '../../libs/constants/batch.constant';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { ProductType } from '../product-types/entities/product-type.entity';
import { UserRole } from '../../libs/constants/user.constant';
import { BatchesService } from './batches.service';
import { Batch } from './entities/batch.entity';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

describe('BatchesService', () => {
  let service: BatchesService;
  let batchesRepository: MockRepository<Batch>;
  let coldRoomsRepository: MockRepository<ColdRoom>;
  let productTypesRepository: MockRepository<ProductType>;

  const dto = {
    coldRoomId: 'r1',
    productTypeId: 'p1',
    batchCode: 'B-001',
    quantity: 100,
    receivedAt: '2026-01-01',
    expiryDate: '2026-02-01',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchesService,
        {
          provide: getRepositoryToken(Batch),
          useValue: createMockRepository<Batch>(),
        },
        {
          provide: getRepositoryToken(ColdRoom),
          useValue: createMockRepository<ColdRoom>(),
        },
        {
          provide: getRepositoryToken(ProductType),
          useValue: createMockRepository<ProductType>(),
        },
      ],
    }).compile();

    service = module.get<BatchesService>(BatchesService);
    batchesRepository = module.get(getRepositoryToken(Batch));
    coldRoomsRepository = module.get(getRepositoryToken(ColdRoom));
    productTypesRepository = module.get(getRepositoryToken(ProductType));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('throws BadRequestException when expiry_date is not after received_at', async () => {
      await expect(
        service.create({ ...dto, expiryDate: '2026-01-01' }),
      ).rejects.toThrow(BadRequestException);
      expect(coldRoomsRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the cold room does not exist', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the product type does not exist', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({ id: 'r1' });
      productTypesRepository.findOne!.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('converts a duplicate batch_code within the cold room into ConflictException', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({ id: 'r1' });
      productTypesRepository.findOne!.mockResolvedValue({ id: 'p1' });
      batchesRepository.create!.mockReturnValue(dto);
      batchesRepository.save!.mockRejectedValue(
        new QueryFailedError('INSERT ...', [], {
          name: 'Error',
          message: 'Duplicate entry',
          code: 'ER_DUP_ENTRY',
        } as unknown as Error),
      );

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('creates the batch as in_stock', async () => {
      coldRoomsRepository.findOne!.mockResolvedValue({ id: 'r1' });
      productTypesRepository.findOne!.mockResolvedValue({ id: 'p1' });
      batchesRepository.create!.mockImplementation((v: Partial<Batch>) => v);
      batchesRepository.save!.mockImplementation((v: Partial<Batch>) => ({
        id: 'b1',
        ...v,
      }));

      const result = await service.create(dto);

      expect(batchesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: BatchStatus.IN_STOCK }),
      );
      expect(result).toMatchObject({ id: 'b1', status: BatchStatus.IN_STOCK });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the batch does not exist', async () => {
      batchesRepository.findOne!.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('bulkRemove', () => {
    const scoped = (warehouseIds: string[] | null) => ({
      userId: 'u1',
      role: UserRole.MANAGER,
      warehouseIds,
      staffWarehouseIds: [],
    });

    it('removes in-scope batches and rejects the rest per row', async () => {
      batchesRepository.find!.mockResolvedValue([
        { id: 'b1', coldRoom: { warehouseId: 'w1' } },
        { id: 'b2', coldRoom: { warehouseId: 'w2' } },
      ]);
      const remove = jest.spyOn(service, 'remove').mockResolvedValue(undefined);

      const result = await service.bulkRemove(
        ['b1', 'b2', 'b3'],
        scoped(['w1']),
      );

      expect(result.deleted).toEqual(['b1']);
      expect(result.failed.map((f) => [f.id, f.statusCode])).toEqual([
        ['b2', 403],
        ['b3', 404],
      ]);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledWith('b1');
    });

    it('lets an Admin act on any existing batch', async () => {
      batchesRepository.find!.mockResolvedValue([
        { id: 'b2', coldRoom: { warehouseId: 'w2' } },
      ]);
      jest.spyOn(service, 'remove').mockResolvedValue(undefined);

      const result = await service.bulkRemove(['b2'], scoped(null));

      expect(result).toEqual({ deleted: ['b2'], failed: [] });
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the batch does not exist', async () => {
      batchesRepository.findOne!.mockResolvedValue(null);

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the batch was already removed', async () => {
      batchesRepository.findOne!.mockResolvedValue({
        id: 'b1',
        removedAt: '2026-01-05',
      });

      await expect(service.remove('b1')).rejects.toThrow(ConflictException);
    });

    it('sets removed_at and status to removed', async () => {
      const batch = { id: 'b1', removedAt: null, status: BatchStatus.IN_STOCK };
      batchesRepository.findOne!.mockResolvedValue(batch);
      batchesRepository.save!.mockResolvedValue(batch);

      await service.remove('b1');

      expect(batch.status).toBe(BatchStatus.REMOVED);
      expect(batch.removedAt).not.toBeNull();
      expect(batchesRepository.save).toHaveBeenCalledWith(batch);
    });
  });
});
