import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import { REDIS_CLIENT } from '../../libs/redis/redis.constant';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { UploadFilesService } from '../upload-files/upload-files.service';
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
  let redis: { del: jest.Mock; multi: jest.Mock };
  let pipeline: { set: jest.Mock; del: jest.Mock; exec: jest.Mock };
  let realtimeGateway: { disconnectUser: jest.Mock };

  beforeEach(async () => {
    dataSource = createMockDataSource();
    pipeline = {
      set: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    redis = { del: jest.fn(), multi: jest.fn(() => pipeline) };
    realtimeGateway = { disconnectUser: jest.fn() };
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
        {
          provide: UploadFilesService,
          useValue: { uploadImages: jest.fn(), deleteImage: jest.fn() },
        },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: RealtimeGateway, useValue: realtimeGateway },
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

  describe('update', () => {
    const staffUser = { id: 's1', role: UserRole.STAFF, fullName: 'A' };
    const self = { id: 's1', role: UserRole.STAFF };

    beforeEach(() => {
      repository.save!.mockImplementation((u: User) => Promise.resolve(u));
    });

    it('forbids a non-admin from changing their own role', async () => {
      repository.findOne!.mockResolvedValue({ ...staffUser });

      await expect(
        service.update('s1', { role: UserRole.ADMIN }, self),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('lets a non-admin resend their unchanged role with other edits', async () => {
      repository.findOne!.mockResolvedValue({ ...staffUser });

      await expect(
        service.update('s1', { role: UserRole.STAFF, fullName: 'B' }, self),
      ).resolves.toMatchObject({ fullName: 'B', role: UserRole.STAFF });
    });

    it('lets an admin change a role', async () => {
      repository.findOne!.mockResolvedValue({ ...staffUser });

      await expect(
        service.update(
          's1',
          { role: UserRole.MANAGER },
          { id: 'a1', role: UserRole.ADMIN },
        ),
      ).resolves.toMatchObject({ role: UserRole.MANAGER });
    });
  });

  describe('lock / unlock', () => {
    beforeEach(() => {
      repository.save!.mockImplementation((u: User) => Promise.resolve(u));
    });

    it('refuses to let an admin lock themselves', async () => {
      await expect(service.lock('a1', 'a1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for an unknown user', async () => {
      repository.findOne!.mockResolvedValue(null);

      await expect(service.lock('x', 'a1')).rejects.toThrow(NotFoundException);
    });

    it('locks the account and revokes all of its access immediately', async () => {
      repository.findOne!.mockResolvedValue({
        id: 'u1',
        status: UserStatus.ACTIVE,
        passwordHash: 'h',
      });

      const result = await service.lock('u1', 'a1');

      expect(result).toMatchObject({ id: 'u1', status: UserStatus.LOCKED });
      expect(result).not.toHaveProperty('passwordHash');
      expect(pipeline.set).toHaveBeenCalledWith('blocked:u1', '1');
      expect(pipeline.del).toHaveBeenCalledWith('refresh:u1');
      expect(realtimeGateway.disconnectUser).toHaveBeenCalledWith('u1');
    });

    it('unlocks the account', async () => {
      repository.findOne!.mockResolvedValue({
        id: 'u1',
        status: UserStatus.LOCKED,
      });

      await expect(service.unlock('u1')).resolves.toMatchObject({
        status: UserStatus.ACTIVE,
      });
      expect(redis.del).toHaveBeenCalledWith('blocked:u1');
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
      expect(pipeline.set).toHaveBeenCalledWith('blocked:1', '1');
      expect(realtimeGateway.disconnectUser).toHaveBeenCalledWith('1');
    });
  });
});
