import { SetMetadata } from '@nestjs/common';
import type { EntityTarget, ObjectLiteral } from 'typeorm';
import { AUDIT_KEY } from '../../libs/constants/metadata.constant';

export type AuditSnapshot = Record<string, unknown>;

export interface AuditMeta {
  // "<resource>.<verb>", e.g. "batch.create" — see AuditLog.action.
  action: string;
  // Resource name stored in audit_logs.target_type; also selects how
  // AuditInterceptor derives warehouse_id (see resolveWarehouseId there).
  targetType: string;
  // Entity loaded before/after the handler to build the before/after diff.
  entity: EntityTarget<ObjectLiteral>;
  // Route param holding the target id. When the route has no such param
  // (a create), the id is read from the handler's returned object instead.
  idParam: string;
  // For entities without a single `id` column (e.g. warehouse_staff's
  // composite key): entity field -> route param used to load the snapshots,
  // e.g. { warehouseId: 'warehouseId', userId: 'userId' }. `idParam` then
  // only supplies audit_logs.target_id.
  lookup?: Record<string, string>;
  // Optional override picked from the snapshots, e.g. "user.role_change"
  // when a user update actually changed `role`. Return undefined to keep
  // `action`.
  resolveAction?: (
    before: AuditSnapshot | null,
    after: AuditSnapshot | null,
  ) => string | undefined;
}

export type AuditOptions = Omit<AuditMeta, 'idParam'> & { idParam?: string };

// Opt-in audit logging for a mutating route: AuditInterceptor (global) only
// acts on handlers carrying this metadata, so reads and unannotated routes
// never produce entries. Written only after the handler succeeds.
export const Audit = (options: AuditOptions) =>
  SetMetadata<string, AuditMeta>(AUDIT_KEY, {
    ...options,
    idParam: options.idParam ?? 'id',
  });
