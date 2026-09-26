import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { In } from 'typeorm';
import {
  ROLES_KEY,
  WAREHOUSE_LIST_SCOPE_KEY,
  WAREHOUSE_SCOPE_KEY,
} from '../../libs/constants/metadata.constant';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import type { WarehouseAccess } from '../rbac/warehouse-access';
import { WarehouseAccessService } from '../rbac/warehouse-access.service';
import { WarehouseScopeGuard } from './warehouse-scope.guard';

describe('WarehouseScopeGuard', () => {
  let warehouseStaffRepo: { existsBy: jest.Mock; find: jest.Mock };
  let workShiftRepo: { find: jest.Mock; findOne: jest.Mock };
  let metadata: Record<string, unknown>;
  let guard: WarehouseScopeGuard;

  const scope = (options: Record<string, unknown> = {}) => ({
    source: WarehouseScopeSource.WAREHOUSE_PARAM,
    paramName: 'id',
    requireShift: false,
    ownStaffOnly: false,
    ...options,
  });

  const run = async (role: UserRole, params: Record<string, string> = {}) => {
    const request: {
      user: { id: string; role: UserRole };
      params: Record<string, string>;
      warehouseAccess?: WarehouseAccess;
    } = { user: { id: 'u1', role }, params };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const allowed = await guard.canActivate(context);
    return { allowed, request };
  };

  beforeEach(() => {
    metadata = {};
    warehouseStaffRepo = { existsBy: jest.fn(), find: jest.fn() };
    workShiftRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };
    const reflector = {
      getAllAndOverride: jest.fn((key: string) => metadata[key]),
    } as unknown as Reflector;
    const unused = {} as never;
    guard = new WarehouseScopeGuard(
      reflector,
      warehouseStaffRepo as never,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      workShiftRepo as never,
      new WarehouseAccessService(
        warehouseStaffRepo as never,
        workShiftRepo as never,
      ),
    );
  });

  describe('single-resource routes (@WarehouseScope)', () => {
    it('lets an admin through without any lookup', async () => {
      metadata[WAREHOUSE_SCOPE_KEY] = scope();

      await expect(run(UserRole.ADMIN, { id: 'w1' })).resolves.toMatchObject({
        allowed: true,
      });
      expect(warehouseStaffRepo.existsBy).not.toHaveBeenCalled();
    });

    it('rejects a user not assigned to the warehouse', async () => {
      metadata[WAREHOUSE_SCOPE_KEY] = scope();
      warehouseStaffRepo.existsBy.mockResolvedValue(false);

      await expect(run(UserRole.MANAGER, { id: 'w1' })).rejects.toThrow(
        'Not assigned to this warehouse',
      );
    });

    it('rejects an assigned user whose role is not in @Roles, before any lookup', async () => {
      metadata[WAREHOUSE_SCOPE_KEY] = scope();
      metadata[ROLES_KEY] = [UserRole.ADMIN, UserRole.MANAGER];
      warehouseStaffRepo.existsBy.mockResolvedValue(true);

      await expect(run(UserRole.STAFF, { id: 'w1' })).rejects.toThrow(
        ForbiddenException,
      );
      expect(warehouseStaffRepo.existsBy).not.toHaveBeenCalled();
    });

    it('allows an assigned user whose role is in @Roles', async () => {
      metadata[WAREHOUSE_SCOPE_KEY] = scope();
      metadata[ROLES_KEY] = [UserRole.ADMIN, UserRole.MANAGER];
      warehouseStaffRepo.existsBy.mockResolvedValue(true);

      await expect(run(UserRole.MANAGER, { id: 'w1' })).resolves.toMatchObject({
        allowed: true,
      });
      expect(warehouseStaffRepo.existsBy).toHaveBeenCalledWith({
        userId: 'u1',
        warehouseId: 'w1',
      });
    });

    it('requires an active shift for Staff', async () => {
      metadata[WAREHOUSE_SCOPE_KEY] = scope({ requireShift: true });
      warehouseStaffRepo.existsBy.mockResolvedValue(true);
      workShiftRepo.find.mockResolvedValue([]);

      await expect(run(UserRole.STAFF, { id: 'w1' })).rejects.toThrow(
        'Requires an approved work shift in progress for this warehouse',
      );
    });

    it('skips the shift check for roles other than Staff', async () => {
      metadata[WAREHOUSE_SCOPE_KEY] = scope({ requireShift: true });
      warehouseStaffRepo.existsBy.mockResolvedValue(true);

      await expect(
        run(UserRole.TECHNICIAN, { id: 'w1' }),
      ).resolves.toMatchObject({ allowed: true });
      expect(workShiftRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('warehouse resolution', () => {
    const queryBuilder = (row: unknown) => {
      const qb = {
        innerJoin: jest.fn(),
        select: jest.fn(),
        where: jest.fn(),
        getRawOne: jest.fn().mockResolvedValue(row),
      };
      qb.innerJoin.mockReturnValue(qb);
      qb.select.mockReturnValue(qb);
      qb.where.mockReturnValue(qb);
      return qb;
    };

    it('walks command → channel → device → cold room in a single query', async () => {
      const qb = queryBuilder({ warehouseId: 'w1' });
      const commandRepo = { createQueryBuilder: jest.fn(() => qb) };
      const reflector = {
        getAllAndOverride: jest.fn((key: string) => metadata[key]),
      } as unknown as Reflector;
      const unused = {} as never;
      guard = new WarehouseScopeGuard(
        reflector,
        warehouseStaffRepo as never,
        unused,
        unused,
        unused,
        unused,
        commandRepo as never,
        unused,
        workShiftRepo as never,
        new WarehouseAccessService(
          warehouseStaffRepo as never,
          workShiftRepo as never,
        ),
      );
      metadata[WAREHOUSE_SCOPE_KEY] = scope({
        source: WarehouseScopeSource.COMMAND_PARAM,
      });
      warehouseStaffRepo.existsBy.mockResolvedValue(true);

      await run(UserRole.MANAGER, { id: 'cmd1' });

      expect(commandRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(qb.innerJoin.mock.calls).toEqual([
        ['target.channel', 'hop0'],
        ['hop0.device', 'hop1'],
        ['hop1.coldRoom', 'hop2'],
      ]);
      expect(qb.select).toHaveBeenCalledWith('hop2.warehouseId', 'warehouseId');
      expect(qb.where).toHaveBeenCalledWith('target.id = :id', { id: 'cmd1' });
      expect(warehouseStaffRepo.existsBy).toHaveBeenCalledWith({
        userId: 'u1',
        warehouseId: 'w1',
      });
    });

    it('rejects when the chain does not reach a warehouse (e.g. unclaimed device)', async () => {
      const qb = queryBuilder(undefined);
      const deviceRepo = { createQueryBuilder: jest.fn(() => qb) };
      const reflector = {
        getAllAndOverride: jest.fn((key: string) => metadata[key]),
      } as unknown as Reflector;
      const unused = {} as never;
      guard = new WarehouseScopeGuard(
        reflector,
        warehouseStaffRepo as never,
        unused,
        deviceRepo as never,
        unused,
        unused,
        unused,
        unused,
        workShiftRepo as never,
        new WarehouseAccessService(
          warehouseStaffRepo as never,
          workShiftRepo as never,
        ),
      );
      metadata[WAREHOUSE_SCOPE_KEY] = scope({
        source: WarehouseScopeSource.DEVICE_PARAM,
      });

      await expect(run(UserRole.TECHNICIAN, { id: 'd1' })).rejects.toThrow(
        'Resource is not assigned to any warehouse you can access',
      );
      expect(warehouseStaffRepo.existsBy).not.toHaveBeenCalled();
    });
  });

  describe('list routes (@WarehouseListScope)', () => {
    it('gives an admin unrestricted access', async () => {
      metadata[WAREHOUSE_LIST_SCOPE_KEY] = { requireShift: false };

      const { request } = await run(UserRole.ADMIN);

      expect(request.warehouseAccess?.warehouseIds).toBeNull();
    });

    it('gives every assigned warehouse when the role is in @Roles', async () => {
      metadata[WAREHOUSE_LIST_SCOPE_KEY] = { requireShift: false };
      metadata[ROLES_KEY] = [
        UserRole.ADMIN,
        UserRole.MANAGER,
        UserRole.TECHNICIAN,
      ];
      warehouseStaffRepo.find.mockResolvedValue([
        { warehouseId: 'w1' },
        { warehouseId: 'w2' },
      ]);

      const { allowed, request } = await run(UserRole.TECHNICIAN);

      expect(allowed).toBe(true);
      expect(request.warehouseAccess).toEqual({
        userId: 'u1',
        role: UserRole.TECHNICIAN,
        warehouseIds: ['w1', 'w2'],
        staffWarehouseIds: [],
      });
    });

    it('gives nothing, without a lookup, when the role is not in @Roles', async () => {
      metadata[WAREHOUSE_LIST_SCOPE_KEY] = { requireShift: false };
      metadata[ROLES_KEY] = [UserRole.ADMIN, UserRole.MANAGER];

      const { allowed, request } = await run(UserRole.STAFF);

      expect(allowed).toBe(true);
      expect(request.warehouseAccess?.warehouseIds).toEqual([]);
      expect(warehouseStaffRepo.find).not.toHaveBeenCalled();
    });

    it('marks every warehouse of a Staff caller as a Staff warehouse', async () => {
      metadata[WAREHOUSE_LIST_SCOPE_KEY] = { requireShift: false };
      warehouseStaffRepo.find.mockResolvedValue([
        { warehouseId: 'w1' },
        { warehouseId: 'w2' },
      ]);

      const { request } = await run(UserRole.STAFF);

      expect(request.warehouseAccess?.staffWarehouseIds).toEqual(['w1', 'w2']);
    });

    it('drops Staff warehouses without an active shift when requireShift is set', async () => {
      metadata[WAREHOUSE_LIST_SCOPE_KEY] = { requireShift: true };
      warehouseStaffRepo.find.mockResolvedValue([
        { warehouseId: 'w1' },
        { warehouseId: 'w2' },
      ]);
      workShiftRepo.find.mockResolvedValue([{ warehouseId: 'w2' }]);

      const { request } = await run(UserRole.STAFF);

      const [shiftQuery] = workShiftRepo.find.mock.calls[0] as [
        { where: { warehouseId: unknown } },
      ];
      expect(shiftQuery.where.warehouseId).toEqual(In(['w1', 'w2']));
      expect(request.warehouseAccess?.warehouseIds).toEqual(['w2']);
    });
  });
});
