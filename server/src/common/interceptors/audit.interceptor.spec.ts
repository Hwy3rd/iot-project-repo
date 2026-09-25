import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { DataSource } from 'typeorm';
import { AUDIT_KEY } from '../../libs/constants/metadata.constant';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { Batch } from '../../modules/batches/entities/batch.entity';
import { ColdRoom } from '../../modules/cold-rooms/entities/cold-room.entity';
import { User } from '../../modules/users/entities/user.entity';
import { WarehouseStaff } from '../../modules/warehouses/entities/warehouse-staff.entity';
import type { CreateAuditLogDto } from '../../modules/audit-logs/dto/create-audit-log.dto';
import type { AuditMeta } from '../decorators/audit.decorator';
import { AuditInterceptor } from './audit.interceptor';

describe('AuditInterceptor', () => {
  let reflector: { get: jest.Mock };
  let auditLogsService: {
    create: jest.Mock<Promise<unknown>, [CreateAuditLogDto]>;
  };
  let repos: Map<unknown, { findOne: jest.Mock }>;
  let interceptor: AuditInterceptor;

  const repo = (entity: unknown) => {
    if (!repos.has(entity)) repos.set(entity, { findOne: jest.fn() });
    return repos.get(entity)!;
  };

  const buildContext = (params: Record<string, string> = {}) =>
    ({
      getHandler: () => () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'actor-1' },
          params,
          ip: '10.0.0.1',
          headers: { 'user-agent': 'jest-ua' },
        }),
      }),
    }) as unknown as ExecutionContext;

  const recordedEntry = () => auditLogsService.create.mock.calls[0][0];

  const handler = (value: unknown): CallHandler => ({
    handle: () => of(value),
  });

  beforeEach(() => {
    repos = new Map();
    reflector = { get: jest.fn() };
    auditLogsService = {
      create: jest
        .fn<Promise<unknown>, [CreateAuditLogDto]>()
        .mockResolvedValue({}),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => repo(entity)),
    };
    interceptor = new AuditInterceptor(
      reflector as unknown as Reflector,
      auditLogsService as unknown as AuditLogsService,
      dataSource as unknown as DataSource,
    );
  });

  const withMeta = (meta: Partial<AuditMeta>) =>
    reflector.get.mockImplementation((key: string) =>
      key === AUDIT_KEY ? { idParam: 'id', ...meta } : undefined,
    );

  it('bulk: writes one delete entry per id the handler reports as deleted', async () => {
    withMeta({
      action: 'cold_room.delete',
      targetType: 'cold_room',
      entity: ColdRoom,
      bulk: true,
    });
    const rows: Record<string, object> = {
      cr1: { id: 'cr1', warehouseId: 'w1', name: 'A1' },
      cr2: { id: 'cr2', warehouseId: 'w1', name: 'A2' },
    };
    // "before" for every requested id; "after" is gone for the deleted one.
    repo(ColdRoom).findOne.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(rows[where.id] ?? null),
    );
    const context = {
      getHandler: () => () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'actor-1' },
          params: {},
          body: { ids: ['cr1', 'cr2'] },
          ip: '10.0.0.1',
          headers: { 'user-agent': 'jest-ua' },
        }),
      }),
    } as unknown as ExecutionContext;
    const bulkHandler: CallHandler = {
      handle: () => {
        delete rows.cr1;
        return of({
          deleted: ['cr1'],
          failed: [{ id: 'cr2', statusCode: 409, message: 'x' }],
        });
      },
    };

    await lastValueFrom(interceptor.intercept(context, bulkHandler));

    expect(auditLogsService.create).toHaveBeenCalledTimes(1);
    expect(recordedEntry()).toEqual({
      userId: 'actor-1',
      warehouseId: 'w1',
      action: 'cold_room.delete',
      targetType: 'cold_room',
      targetId: 'cr1',
      metadata: {
        before: { id: 'cr1', warehouseId: 'w1', name: 'A1' },
        request: { ip: '10.0.0.1', userAgent: 'jest-ua' },
      },
    });
  });

  it('passes through untouched when the handler has no @Audit()', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(buildContext(), handler({ id: 'x' })),
    );

    expect(result).toEqual({ id: 'x' });
    expect(auditLogsService.create).not.toHaveBeenCalled();
  });

  it('records a create with the new row as "after" and resolves the warehouse', async () => {
    withMeta({ action: 'batch.create', targetType: 'batch', entity: Batch });
    repo(Batch).findOne.mockResolvedValue({
      id: 'b1',
      coldRoomId: 'cr1',
      quantity: 10,
      createdAt: new Date(),
    });
    repo(ColdRoom).findOne.mockResolvedValue({ id: 'cr1', warehouseId: 'w1' });

    await lastValueFrom(
      interceptor.intercept(buildContext(), handler({ id: 'b1' })),
    );

    expect(auditLogsService.create).toHaveBeenCalledWith({
      userId: 'actor-1',
      warehouseId: 'w1',
      action: 'batch.create',
      targetType: 'batch',
      targetId: 'b1',
      metadata: {
        after: { id: 'b1', coldRoomId: 'cr1', quantity: 10 },
        request: { ip: '10.0.0.1', userAgent: 'jest-ua' },
      },
    });
  });

  it('records only changed fields on an update, with sensitive keys redacted', async () => {
    withMeta({
      action: 'user.update',
      targetType: 'user',
      entity: User,
      resolveAction: (before, after) =>
        before?.role !== after?.role ? 'user.role_change' : undefined,
    });
    repo(User)
      .findOne.mockResolvedValueOnce({
        id: 'u1',
        role: 'staff',
        fullName: 'A',
        passwordHash: 'secret',
      })
      .mockResolvedValueOnce({
        id: 'u1',
        role: 'manager',
        fullName: 'A',
        passwordHash: 'secret',
      });

    await lastValueFrom(
      interceptor.intercept(buildContext({ id: 'u1' }), handler({ id: 'u1' })),
    );

    const entry = recordedEntry();
    expect(entry.action).toBe('user.role_change');
    expect(entry.warehouseId).toBeUndefined();
    expect(entry.metadata?.before).toEqual({ role: 'staff' });
    expect(entry.metadata?.after).toEqual({ role: 'manager' });
    expect(JSON.stringify(entry)).not.toContain('secret');
  });

  it('records a hard delete with the pre-handler row as "before"', async () => {
    withMeta({
      action: 'cold_room.delete',
      targetType: 'cold_room',
      entity: ColdRoom,
    });
    repo(ColdRoom)
      .findOne.mockResolvedValueOnce({
        id: 'cr1',
        warehouseId: 'w1',
        name: 'A',
      })
      .mockResolvedValueOnce(null);

    await lastValueFrom(
      interceptor.intercept(buildContext({ id: 'cr1' }), handler(null)),
    );

    const entry = recordedEntry();
    expect(entry.warehouseId).toBe('w1');
    expect(entry.targetId).toBe('cr1');
    expect(entry.metadata?.before).toEqual({
      id: 'cr1',
      warehouseId: 'w1',
      name: 'A',
    });
  });

  it('loads composite-key rows via `lookup` and records an assignment', async () => {
    withMeta({
      action: 'warehouse_staff.assign',
      targetType: 'warehouse_staff',
      entity: WarehouseStaff,
      idParam: 'userId',
      lookup: { warehouseId: 'warehouseId', userId: 'userId' },
    });
    repo(WarehouseStaff)
      .findOne.mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        warehouseId: 'w1',
        userId: 'u1',
        role: 'staff',
      });

    await lastValueFrom(
      interceptor.intercept(
        buildContext({ warehouseId: 'w1', userId: 'u1' }),
        handler({ warehouseId: 'w1', userId: 'u1' }),
      ),
    );

    expect(repo(WarehouseStaff).findOne).toHaveBeenCalledWith({
      where: { warehouseId: 'w1', userId: 'u1' },
      withDeleted: true,
    });
    const entry = recordedEntry();
    expect(entry.targetId).toBe('u1');
    expect(entry.warehouseId).toBe('w1');
    expect(entry.metadata?.after).toEqual({
      warehouseId: 'w1',
      userId: 'u1',
      role: 'staff',
    });
  });

  it('does not record when the handler throws', async () => {
    withMeta({ action: 'batch.create', targetType: 'batch', entity: Batch });

    await expect(
      lastValueFrom(
        interceptor.intercept(buildContext(), {
          handle: () => throwError(() => new Error('boom')),
        }),
      ),
    ).rejects.toThrow('boom');
    expect(auditLogsService.create).not.toHaveBeenCalled();
  });

  it('still returns the handler result when the audit write fails', async () => {
    withMeta({ action: 'batch.create', targetType: 'batch', entity: Batch });
    repo(Batch).findOne.mockResolvedValue({ id: 'b1', coldRoomId: null });
    auditLogsService.create.mockRejectedValue(new Error('db down'));

    await expect(
      lastValueFrom(
        interceptor.intercept(buildContext(), handler({ id: 'b1' })),
      ),
    ).resolves.toEqual({ id: 'b1' });
  });
});
