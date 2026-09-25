import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import {
  And,
  Equal,
  In,
  IsNull,
  Like,
  MoreThanOrEqual,
  Not,
  Or,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { UserRole } from '../../libs/constants/user.constant';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { UploadFilesService } from '../upload-files/upload-files.service';
import { WarehouseStaff } from './entities/warehouse-staff.entity';
import { Warehouse } from './entities/warehouse.entity';
import { buildWarehouseWhere, WarehousesService } from './warehouses.service';

type MockRepository = Partial<Record<keyof Repository<Warehouse>, jest.Mock>>;

const createMockRepository = (): MockRepository => ({
  findOne: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

const createMockDataSource = () => {
  const manager = { softDelete: jest.fn(), delete: jest.fn() };
  return {
    manager,
    transaction: jest.fn((cb: (entityManager: typeof manager) => unknown) =>
      cb(manager),
    ),
  };
};

describe('WarehousesService', () => {
  let service: WarehousesService;
  let repository: MockRepository;
  let dataSource: ReturnType<typeof createMockDataSource>;

  beforeEach(async () => {
    dataSource = createMockDataSource();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehousesService,
        {
          provide: getRepositoryToken(Warehouse),
          useValue: createMockRepository(),
        },
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
        },
        {
          provide: UploadFilesService,
          useValue: { uploadImages: jest.fn(), deleteImage: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<WarehousesService>(WarehousesService);
    repository = module.get(getRepositoryToken(Warehouse));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('converts a duplicate name/code into ConflictException', async () => {
      repository.create!.mockReturnValue({ name: 'A', code: 'A1' });
      repository.save!.mockRejectedValue(
        new QueryFailedError('INSERT ...', [], {
          name: 'Error',
          message: 'Duplicate entry',
          code: 'ER_DUP_ENTRY',
        } as unknown as Error),
      );

      await expect(service.create({ name: 'A', code: 'A1' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates the warehouse', async () => {
      const created = { name: 'A', code: 'A1', address: null };
      repository.create!.mockReturnValue(created);
      repository.save!.mockResolvedValue({ id: '1', ...created });

      const result = await service.create({ name: 'A', code: 'A1' });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'A', code: 'A1', address: null }),
      );
      expect(result).toEqual({ id: '1', ...created });
    });
  });

  describe('findAll', () => {
    it('returns an empty page without querying when access has no warehouses', async () => {
      const result = await service.findAll(
        {
          userId: 'u1',
          role: UserRole.MANAGER,
          warehouseIds: [],
          staffWarehouseIds: [],
        },
        {},
      );

      expect(repository.findAndCount).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
    });

    it('passes the built filters to the repository', async () => {
      repository.findAndCount!.mockResolvedValue([[], 0]);

      await service.findAll(undefined, { search: 'kho', page: 2, limit: 10 });

      expect(repository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: buildWarehouseWhere({ search: 'kho' }),
          skip: 10,
          take: 10,
        }),
      );
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the warehouse does not exist', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the warehouse does not exist', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.update('missing-id', { name: 'B' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when nothing was deleted', async () => {
      dataSource.manager.softDelete.mockResolvedValue({ affected: 0 });

      await expect(service.remove('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(dataSource.manager.delete).not.toHaveBeenCalled();
    });

    it('soft-deletes the warehouse and cascades to cold_rooms and warehouse_staff', async () => {
      dataSource.manager.softDelete.mockResolvedValue({ affected: 1 });

      await expect(service.remove('1')).resolves.toBeUndefined();
      expect(dataSource.manager.softDelete).toHaveBeenCalledWith(
        Warehouse,
        '1',
      );
      expect(dataSource.manager.softDelete).toHaveBeenCalledWith(ColdRoom, {
        warehouseId: '1',
      });
      expect(dataSource.manager.delete).toHaveBeenCalledWith(WarehouseStaff, {
        warehouseId: '1',
      });
    });
  });
});

describe('buildWarehouseWhere', () => {
  it('is unfiltered with no query and no scope', () => {
    expect(buildWarehouseWhere({})).toEqual({});
  });

  it('restricts to the scoped warehouse ids', () => {
    expect(buildWarehouseWhere({}, ['a', 'b'])).toEqual({ id: In(['a', 'b']) });
  });

  it('treats null and empty-string addresses as missing', () => {
    expect(buildWarehouseWhere({ hasAddress: 'true' })).toEqual({
      address: And(Not(IsNull()), Not(Equal(''))),
    });
    expect(buildWarehouseWhere({ hasAddress: 'false' })).toEqual({
      address: Or(IsNull(), Equal('')),
    });
  });

  it('ORs search across name, code and address, keeping other filters', () => {
    const pattern = Like('%kho%');
    const createdAt = MoreThanOrEqual(new Date('2026-09-01T00:00:00Z'));
    expect(
      buildWarehouseWhere({ search: 'kho', createdFrom: '2026-09-01' }, ['a']),
    ).toEqual([
      { id: In(['a']), createdAt, name: pattern },
      { id: In(['a']), createdAt, code: pattern },
      { id: In(['a']), createdAt, address: pattern },
    ]);
  });
});
