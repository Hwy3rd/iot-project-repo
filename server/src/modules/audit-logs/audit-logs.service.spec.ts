import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { AuditLogsService } from './audit-logs.service';
import { AuditLog } from './entities/audit-log.entity';

type MockRepository<T extends object> = Partial<
  Record<keyof Repository<T>, jest.Mock>
>;

const createMockRepository = <T extends object>(): MockRepository<T> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

describe('AuditLogsService', () => {
  let service: AuditLogsService;
  let auditLogsRepository: MockRepository<AuditLog>;
  let usersRepository: MockRepository<User>;
  let warehousesRepository: MockRepository<Warehouse>;

  const dto = { userId: 'u1', action: 'batch.create' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogsService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: createMockRepository<AuditLog>(),
        },
        {
          provide: getRepositoryToken(User),
          useValue: createMockRepository<User>(),
        },
        {
          provide: getRepositoryToken(Warehouse),
          useValue: createMockRepository<Warehouse>(),
        },
      ],
    }).compile();

    service = module.get<AuditLogsService>(AuditLogsService);
    auditLogsRepository = module.get(getRepositoryToken(AuditLog));
    usersRepository = module.get(getRepositoryToken(User));
    warehousesRepository = module.get(getRepositoryToken(Warehouse));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      usersRepository.findOne!.mockResolvedValue(null);

      await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when warehouseId does not resolve to a warehouse', async () => {
      usersRepository.findOne!.mockResolvedValue({ id: 'u1' });
      warehousesRepository.findOne!.mockResolvedValue(null);

      await expect(
        service.create({ ...dto, warehouseId: 'w1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates the audit log entry', async () => {
      usersRepository.findOne!.mockResolvedValue({ id: 'u1' });
      auditLogsRepository.create!.mockImplementation(
        (v: Partial<AuditLog>) => v,
      );
      auditLogsRepository.save!.mockImplementation((v: Partial<AuditLog>) => ({
        id: 'log1',
        ...v,
      }));

      const result = await service.create(dto);

      expect(auditLogsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          action: 'batch.create',
          warehouseId: null,
          targetType: null,
          targetId: null,
          metadata: null,
        }),
      );
      expect(result).toMatchObject({ id: 'log1', action: 'batch.create' });
    });
  });

  describe('findAll', () => {
    it('filters by the provided query fields only', async () => {
      auditLogsRepository.find!.mockResolvedValue([]);

      await service.findAll({ userId: 'u1', targetType: 'batch' });

      expect(auditLogsRepository.find).toHaveBeenCalledWith({
        where: { userId: 'u1', targetType: 'batch' },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the audit log does not exist', async () => {
      auditLogsRepository.findOne!.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
