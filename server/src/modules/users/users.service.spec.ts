import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

type MockRepository = Partial<Record<keyof Repository<User>, jest.Mock>>;

const createMockRepository = (): MockRepository => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  softDelete: jest.fn(),
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

describe('UsersService', () => {
  let service: UsersService;
  let repository: MockRepository;
  let dataSource: ReturnType<typeof createMockDataSource>;

  beforeEach(async () => {
    dataSource = createMockDataSource();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: createMockRepository(),
        },
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('throws ConflictException when username/email already exists', async () => {
      repository.findOne!.mockResolvedValue({ id: '1' });

      await expect(
        service.create({
          username: 'john',
          password: 'password123',
          role: UserRole.STAFF,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the user and strips passwordHash from the response', async () => {
      repository.findOne!.mockResolvedValue(null);
      const created = { id: '1', username: 'john' } as User;
      repository.create!.mockReturnValue(created);
      repository.save!.mockResolvedValue({
        ...created,
        passwordHash: 'hashed',
      });

      const result = await service.create({
        username: 'john',
        password: 'password123',
        role: UserRole.STAFF,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'john', role: UserRole.STAFF }),
      );
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('converts a duplicate-key race at save() time into ConflictException', async () => {
      repository.findOne!.mockResolvedValue(null);
      repository.create!.mockReturnValue({ id: '1', username: 'john' });
      repository.save!.mockRejectedValue(
        new QueryFailedError('INSERT ...', [], {
          name: 'Error',
          message: 'Duplicate entry',
          code: 'ER_DUP_ENTRY',
        } as unknown as Error),
      );

      await expect(
        service.create({
          username: 'john',
          password: 'password123',
          role: UserRole.STAFF,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('does not swallow unrelated database errors', async () => {
      repository.findOne!.mockResolvedValue(null);
      repository.create!.mockReturnValue({ id: '1', username: 'john' });
      const dbError = new QueryFailedError('INSERT ...', [], {
        name: 'Error',
        message: 'Connection lost',
        code: 'PROTOCOL_CONNECTION_LOST',
      } as unknown as Error);
      repository.save!.mockRejectedValue(dbError);

      await expect(
        service.create({
          username: 'john',
          password: 'password123',
          role: UserRole.STAFF,
        }),
      ).rejects.toBe(dbError);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when user does not exist', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the user without passwordHash', async () => {
      repository.findOne!.mockResolvedValue({
        id: '1',
        username: 'john',
        passwordHash: 'hashed',
        status: UserStatus.ACTIVE,
      });

      const result = await service.findOne('1');

      expect(result).not.toHaveProperty('passwordHash');
    });
  });

  describe('touchLastLogin', () => {
    it('updates lastLoginAt to the current time', async () => {
      await service.touchLastLogin('1');

      const [id, payload] = repository.update!.mock.calls[0] as [
        string,
        { lastLoginAt: Date },
      ];
      expect(id).toBe('1');
      expect(payload.lastLoginAt).toBeInstanceOf(Date);
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

    it('soft-deletes the user and cleans up their warehouse_staff rows', async () => {
      dataSource.manager.softDelete.mockResolvedValue({ affected: 1 });

      await expect(service.remove('1')).resolves.toBeUndefined();
      expect(dataSource.manager.softDelete).toHaveBeenCalledWith(User, '1');
      expect(dataSource.manager.delete).toHaveBeenCalledWith(WarehouseStaff, {
        userId: '1',
      });
    });
  });
});
