import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { WAREHOUSE_LIST_SCOPE_KEY } from '../../libs/constants/metadata.constant';
import type { WarehouseAccess } from '../rbac/warehouse-access';

export interface WarehouseListScopeMeta {
  // Staff only: a warehouse where the caller acts as Staff counts only
  // while they're checked into an active shift there — mirror the
  // matching per-resource route's @WarehouseScope({ requireShift }).
  requireShift: boolean;
}

// Marks a list route as warehouse-scoped: WarehouseScopeGuard resolves the
// caller's readable warehouses (see WarehouseAccess) and attaches them to
// the request instead of rejecting — the service does the filtering.
// Admin always gets unrestricted access. Read it with @ScopedWarehouses().
export const WarehouseListScope = (options: { requireShift?: boolean } = {}) =>
  SetMetadata<string, WarehouseListScopeMeta>(WAREHOUSE_LIST_SCOPE_KEY, {
    requireShift: options.requireShift ?? false,
  });

export const ScopedWarehouses = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WarehouseAccess => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ warehouseAccess?: WarehouseAccess }>();
    if (!request.warehouseAccess) {
      // Fail closed: a route using this without @WarehouseListScope() is a
      // wiring bug, never a reason to return unfiltered data.
      throw new Error(
        '@ScopedWarehouses() used on a route without @WarehouseListScope()',
      );
    }
    return request.warehouseAccess;
  },
);
