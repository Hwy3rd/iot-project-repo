import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
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
  let warehouseStaffRepository: MockRepository<WarehouseStaff>;

  const manager = { id: 'm1', role: UserRole.MANAGER };
  const admin = { id: 'a1', role: UserRole.ADMIN };

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
          provide: getRepositoryToken(WarehouseStaff),
          useValue: createMockRepository<WarehouseStaff>(),
        },
      ],
    }).compile();

    service = module.get<AuditLogsService>(AuditLogsService);
    auditLogsRepository = module.get(getRepositoryToken(AuditLog));
    warehouseStaffRepository = module.get(getRepositoryToken(WarehouseStaff));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates the audit log entry without pre-checking user/warehouse', async () => {
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

    it('does not narrow results for an admin', async () => {
      auditLogsRepository.find!.mockResolvedValue([]);

      await service.findAll({}, admin);

      expect(warehouseStaffRepository.find).not.toHaveBeenCalled();
      expect(auditLogsRepository.find).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
      });
    });

    it('limits a manager to warehouses they manage', async () => {
      warehouseStaffRepository.find!.mockResolvedValue([
        { warehouseId: 'w1' },
        { warehouseId: 'w2' },
      ]);
      auditLogsRepository.find!.mockResolvedValue([]);

      await service.findAll({ targetType: 'batch' }, manager);

      expect(warehouseStaffRepository.find).toHaveBeenCalledWith({
        where: { userId: 'm1', role: UserRole.MANAGER },
      });
      expect(auditLogsRepository.find).toHaveBeenCalledWith({
        where: { targetType: 'batch', warehouseId: In(['w1', 'w2']) },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns an empty list for a manager with no managed warehouse', async () => {
      warehouseStaffRepository.find!.mockResolvedValue([]);

      await expect(service.findAll({}, manager)).resolves.toEqual([]);
      expect(auditLogsRepository.find).not.toHaveBeenCalled();
    });

    it('rejects a manager filtering by a warehouse they do not manage', async () => {
      warehouseStaffRepository.find!.mockResolvedValue([{ warehouseId: 'w1' }]);

      await expect(
        service.findAll({ warehouseId: 'w9' }, manager),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the audit log does not exist', async () => {
      auditLogsRepository.findOne!.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lets a manager read an entry from a warehouse they manage', async () => {
      auditLogsRepository.findOne!.mockResolvedValue({
        id: 'log1',
        warehouseId: 'w1',
      });
      warehouseStaffRepository.find!.mockResolvedValue([{ warehouseId: 'w1' }]);

      await expect(service.findOne('log1', manager)).resolves.toMatchObject({
        id: 'log1',
      });
    });

    it('rejects a manager reading an entry outside their warehouses', async () => {
      auditLogsRepository.findOne!.mockResolvedValue({
        id: 'log1',
        warehouseId: 'w9',
      });
      warehouseStaffRepository.find!.mockResolvedValue([{ warehouseId: 'w1' }]);

      await expect(service.findOne('log1', manager)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects a manager reading an entry not scoped to any warehouse', async () => {
      auditLogsRepository.findOne!.mockResolvedValue({
        id: 'log1',
        warehouseId: null,
      });
      warehouseStaffRepository.find!.mockResolvedValue([{ warehouseId: 'w1' }]);

      await expect(service.findOne('log1', manager)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
