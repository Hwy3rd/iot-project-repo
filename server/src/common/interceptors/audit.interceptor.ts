import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { concatMap, from, Observable } from 'rxjs';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { AUDIT_KEY } from '../../libs/constants/metadata.constant';
import { AuditLogsService } from '../../modules/audit-logs/audit-logs.service';
import { ColdRoom } from '../../modules/cold-rooms/entities/cold-room.entity';
import { Device } from '../../modules/devices/entities/device.entity';
import type { AuditMeta, AuditSnapshot } from '../decorators/audit.decorator';

interface AuditRequest {
  user?: { id: string };
  params?: Record<string, string>;
  body?: unknown;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}

// Never persisted in an audit entry, whatever entity they appear on.
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'claimCode',
  'claimCodeHash',
  'refreshToken',
]);
// Bookkeeping columns that change on every write and carry no audit value.
const IGNORED_KEYS = new Set(['createdAt', 'updatedAt']);

// Writes an audit_logs entry for every successful handler annotated with
// @Audit() — see common/decorators/audit.decorator.ts. Registered globally;
// a no-op for everything else.
//
// Deliberately a leaf: it only reads the target entity and appends through
// AuditLogsService, never calls another module, so an audit write can't
// trigger further audited actions. A failed audit write is logged to stdout
// and swallowed — it must not turn a completed business action into an
// error response.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogsService: AuditLogsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(
      AUDIT_KEY,
      context.getHandler(),
    );
    if (!meta) return next.handle();

    const request = context.switchToHttp().getRequest<AuditRequest>();
    if (meta.bulk) return this.interceptBulk(meta, request, next);

    const paramId = request.params?.[meta.idParam];
    const paramWhere = buildWhere(meta, request.params ?? {}, paramId);

    // Snapshot before the handler runs (update/delete); a create has no
    // param id and so no "before".
    const before$ = from(
      paramWhere
        ? this.loadSnapshot(meta.entity, paramWhere)
        : Promise.resolve(null),
    );

    return before$.pipe(
      concatMap((before) =>
        next.handle().pipe(
          concatMap(async (result: unknown) => {
            await this.record(
              meta,
              request,
              paramId,
              paramWhere,
              before,
              result,
            );
            return result;
          }),
        ),
      ),
    );
  }

  // One "before" per requested id, then one entry per id that was actually
  // deleted — failed ids changed nothing and get no entry.
  private interceptBulk(
    meta: AuditMeta,
    request: AuditRequest,
    next: CallHandler,
  ): Observable<unknown> {
    const ids = bodyIds(request.body);
    const before$ = from(
      Promise.all(
        ids.map(
          async (id) =>
            [id, await this.loadSnapshot(meta.entity, { id })] as const,
        ),
      ),
    );
    return before$.pipe(
      concatMap((befores) => {
        const before = new Map(befores);
        return next.handle().pipe(
          concatMap(async (result: unknown) => {
            for (const id of deletedIds(result)) {
              await this.record(
                meta,
                request,
                id,
                { id },
                before.get(id) ?? null,
                result,
              );
            }
            return result;
          }),
        );
      }),
    );
  }

  private async record(
    meta: AuditMeta,
    request: AuditRequest,
    paramId: string | undefined,
    paramWhere: Record<string, string> | null,
    before: AuditSnapshot | null,
    result: unknown,
  ): Promise<void> {
    try {
      const userId = request.user?.id;
      if (!userId) {
        this.logger.warn(
          `Skipping audit "${meta.action}": no authenticated user`,
        );
        return;
      }

      const targetId = paramId ?? extractId(result);
      const afterWhere =
        paramWhere ?? (targetId && !meta.lookup ? { id: targetId } : null);
      const after = afterWhere
        ? await this.loadSnapshot(meta.entity, afterWhere)
        : null;

      const userAgent = request.headers?.['user-agent'];
      await this.auditLogsService.create({
        userId,
        warehouseId:
          (await this.resolveWarehouseId(meta.targetType, after ?? before)) ??
          undefined,
        action: meta.resolveAction?.(before, after) ?? meta.action,
        targetType: meta.targetType,
        targetId: targetId ?? undefined,
        metadata: {
          ...buildChange(before, after),
          request: {
            ip: request.ip ?? null,
            userAgent: Array.isArray(userAgent)
              ? userAgent[0]
              : (userAgent ?? null),
          },
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log "${meta.action}"`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // withDeleted: a soft-deleted row's "after" should still be readable so
  // the entry shows deletedAt being set.
  private async loadSnapshot(
    entity: EntityTarget<ObjectLiteral>,
    where: Record<string, string>,
  ): Promise<AuditSnapshot | null> {
    const row = await this.dataSource
      .getRepository(entity)
      .findOne({ where, withDeleted: true });
    return row ? sanitize(row) : null;
  }

  // Same entity chains as WarehouseScopeGuard, walked from the snapshot
  // instead of from route params. Null for resources not owned by a single
  // warehouse (users, product types, shift templates) — those entries stay
  // Admin-only (see AuditLogsService.findAll).
  private async resolveWarehouseId(
    targetType: string,
    snapshot: AuditSnapshot | null,
  ): Promise<string | null> {
    if (!snapshot) return null;
    switch (targetType) {
      case 'warehouse':
        return asString(snapshot.id);
      case 'cold_room':
      case 'work_shift':
      case 'warehouse_staff':
        return asString(snapshot.warehouseId);
      case 'batch':
      case 'device':
        return this.warehouseIdOfColdRoom(asString(snapshot.coldRoomId));
      case 'device_channel': {
        const deviceId = asString(snapshot.deviceId);
        if (!deviceId) return null;
        const device = await this.dataSource
          .getRepository(Device)
          .findOne({ where: { id: deviceId }, withDeleted: true });
        return this.warehouseIdOfColdRoom(device?.coldRoomId ?? null);
      }
      default:
        return null;
    }
  }

  private async warehouseIdOfColdRoom(
    coldRoomId: string | null,
  ): Promise<string | null> {
    if (!coldRoomId) return null;
    const coldRoom = await this.dataSource
      .getRepository(ColdRoom)
      .findOne({ where: { id: coldRoomId }, withDeleted: true });
    return coldRoom?.warehouseId ?? null;
  }
}

// Lookup for the target row from route params: the `lookup` map for
// composite keys, else { id: <idParam> }. Null when the route lacks the
// params (a create) — its row is then located from the handler's result.
function buildWhere(
  meta: AuditMeta,
  params: Record<string, string>,
  paramId: string | undefined,
): Record<string, string> | null {
  if (!meta.lookup) return paramId ? { id: paramId } : null;
  const where: Record<string, string> = {};
  for (const [field, param] of Object.entries(meta.lookup)) {
    if (!params[param]) return null;
    where[field] = params[param];
  }
  return where;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function bodyIds(body: unknown): string[] {
  const ids = (body as { ids?: unknown } | undefined)?.ids;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === 'string')
    : [];
}

// `deleted` of a BulkDeleteResult, unwrapping the response envelope like
// extractId does.
function deletedIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const record = result as Record<string, unknown>;
  if ('success' in record && 'data' in record) return deletedIds(record.data);
  return Array.isArray(record.deleted)
    ? record.deleted.filter((id): id is string => typeof id === 'string')
    : [];
}

// The handler's own return value — or, if this interceptor happens to run
// outside TransformInterceptor, the `data` inside its response envelope.
function extractId(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const record = result as Record<string, unknown>;
  if ('success' in record && 'data' in record) return extractId(record.data);
  return asString(record.id);
}

function sanitize(row: ObjectLiteral): AuditSnapshot {
  const snapshot: AuditSnapshot = {};
  for (const [key, value] of Object.entries(row)) {
    if (REDACTED_KEYS.has(key) || IGNORED_KEYS.has(key)) continue;
    // Relations aren't loaded, but guard anyway so a nested entity never
    // drags its own sensitive columns into the entry.
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if (!Array.isArray(value)) continue;
    }
    snapshot[key] = value;
  }
  return snapshot;
}

// create → { after }, delete (row gone) → { before }, update → only the
// fields that actually changed, on both sides.
function buildChange(
  before: AuditSnapshot | null,
  after: AuditSnapshot | null,
): Record<string, unknown> {
  if (!before) return { after };
  if (!after) return { before };

  const changedBefore: AuditSnapshot = {};
  const changedAfter: AuditSnapshot = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return { before: changedBefore, after: changedAfter };
}
