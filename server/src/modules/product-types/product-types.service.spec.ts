import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { ProductUnit } from '../../libs/constants/product-unit.constant';
import { ProductType } from './entities/product-type.entity';
import { ProductTypesService } from './product-types.service';

type MockRepository = Partial<Record<keyof Repository<ProductType>, jest.Mock>>;

const createMockRepository = (): MockRepository => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  softDelete: jest.fn(),
});

describe('ProductTypesService', () => {
  let service: ProductTypesService;
  let repository: MockRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductTypesService,
        {
          provide: getRepositoryToken(ProductType),
          useValue: createMockRepository(),
        },
      ],
    }).compile();

    service = module.get<ProductTypesService>(ProductTypesService);
    repository = module.get(getRepositoryToken(ProductType));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('converts a duplicate name into ConflictException', async () => {
      repository.create!.mockReturnValue({ name: 'Frozen Fish' });
      repository.save!.mockRejectedValue(
        new QueryFailedError('INSERT ...', [], {
          name: 'Error',
          message: 'Duplicate entry',
          code: 'ER_DUP_ENTRY',
        } as unknown as Error),
      );

      await expect(
        service.create({ name: 'Frozen Fish', unit: ProductUnit.KG }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the product type does not exist', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      repository.softDelete!.mockResolvedValue({ affected: 0 });

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes the product type', async () => {
      repository.softDelete!.mockResolvedValue({ affected: 1 });

      await expect(service.remove('1')).resolves.toBeUndefined();
      expect(repository.softDelete).toHaveBeenCalledWith('1');
    });
  });
});
