import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserRole } from '../../libs/constants/user.constant';
import { User } from '../users/entities/user.entity';
import { WarehouseStaff } from './entities/warehouse-staff.entity';
import { Warehouse } from './entities/warehouse.entity';
import { WarehouseStaffService } from './warehouse-staff.service';

describe('WarehouseStaffService', () => {
  let service: WarehouseStaffService;
  let staffRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let warehousesRepo: { existsBy: jest.Mock };
  let usersRepo: { existsBy: jest.Mock };

  beforeEach(async () => {
    staffRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((v: Partial<WarehouseStaff>) => ({ ...v })),
      save: jest.fn((v: Partial<WarehouseStaff>) => Promise.resolve(v)),
      delete: jest.fn(),
    };
    warehousesRepo = { existsBy: jest.fn().mockResolvedValue(true) };
    usersRepo = { existsBy: jest.fn().mockResolvedValue(true) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehouseStaffService,
        { provide: getRepositoryToken(WarehouseStaff), useValue: staffRepo },
        { provide: getRepositoryToken(Warehouse), useValue: warehousesRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
      ],
    }).compile();

    service = module.get(WarehouseStaffService);
  });

  describe('findAll', () => {
    it('throws NotFoundException for an unknown warehouse', async () => {
      warehousesRepo.existsBy.mockResolvedValue(false);

      await expect(service.findAll('w9')).rejects.toThrow(NotFoundException);
    });

    it('lists the warehouse assignments with their users', async () => {
      staffRepo.find.mockResolvedValue([]);

      await service.findAll('w1');

      expect(staffRepo.find).toHaveBeenCalledWith({
        where: { warehouseId: 'w1' },
        relations: { user: true },
        order: { createdAt: 'ASC' },
      });
    });
  });

  describe('assign', () => {
    it('throws NotFoundException for an unknown user', async () => {
      usersRepo.existsBy.mockResolvedValue(false);

      await expect(
        service.assign('w1', 'u9', { role: UserRole.STAFF }),
      ).rejects.toThrow(NotFoundException);
      expect(staffRepo.save).not.toHaveBeenCalled();
    });

    it('creates a new assignment', async () => {
      staffRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assign('w1', 'u1', { role: UserRole.TECHNICIAN }),
      ).resolves.toEqual({
        warehouseId: 'w1',
        userId: 'u1',
        role: UserRole.TECHNICIAN,
      });
    });

    it('changes the role of an existing assignment instead of duplicating it', async () => {
      staffRepo.findOne.mockResolvedValue({
        warehouseId: 'w1',
        userId: 'u1',
        role: UserRole.STAFF,
      });

      const result = await service.assign('w1', 'u1', {
        role: UserRole.MANAGER,
      });

      expect(staffRepo.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ role: UserRole.MANAGER });
    });
  });

  describe('unassign', () => {
    it('throws NotFoundException when the user is not assigned', async () => {
      staffRepo.delete.mockResolvedValue({ affected: 0 });

      await expect(service.unassign('w1', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('removes the assignment', async () => {
      staffRepo.delete.mockResolvedValue({ affected: 1 });

      await service.unassign('w1', 'u1');

      expect(staffRepo.delete).toHaveBeenCalledWith({
        warehouseId: 'w1',
        userId: 'u1',
      });
    });
  });
});
