import { SetMetadata } from '@nestjs/common';
import { WAREHOUSE_SCOPE_KEY } from '../../libs/constants/metadata.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';

export interface WarehouseScopeMeta {
  source: WarehouseScopeSource;
  paramName: string;
  // Staff always need an active WorkShift (approved, in progress) in the
  // resolved warehouse (docs/RBAC.md §3) — except on routes that set this,
  // i.e. the attendance flow itself (check in/out, own shift). Ignored for
  // other roles.
  allowOffShift: boolean;
  // Staff only, WORK_SHIFT_PARAM sources: also requires the target WorkShift's
  // staffId to equal the caller (e.g. check out of your own shift).
  ownStaffOnly: boolean;
}

export interface WarehouseScopeOptions {
  // Route param or body field name to read the id from. Defaults to 'id'.
  paramName?: string;
  allowOffShift?: boolean;
  ownStaffOnly?: boolean;
}

// Declares that a route is scoped to "the warehouse the caller is assigned
// to" (see docs/rbac.md §3-4). Admin always bypasses this check. Requires
// RbacModule's global WarehouseScopeGuard to be active.
export const WarehouseScope = (
  source: WarehouseScopeSource,
  options: WarehouseScopeOptions = {},
) =>
  SetMetadata<string, WarehouseScopeMeta>(WAREHOUSE_SCOPE_KEY, {
    source,
    paramName: options.paramName ?? 'id',
    allowOffShift: options.allowOffShift ?? false,
    ownStaffOnly: options.ownStaffOnly ?? false,
  });
