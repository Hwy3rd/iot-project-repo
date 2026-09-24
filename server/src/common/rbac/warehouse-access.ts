import { UserRole } from '../../libs/constants/user.constant';

// Which warehouses a caller may read on a list endpoint — computed by
// WarehouseScopeGuard for routes marked @WarehouseListScope() and handed to
// the controller via @ScopedWarehouses(). Services turn it into a WHERE
// clause, so list results match what the per-resource routes would allow.
export interface WarehouseAccess {
  userId: string;
  role: UserRole;
  // null = unrestricted (Admin). Otherwise the warehouses where the caller's
  // role *in that warehouse* (warehouse_staff.role) is one of the route's
  // @Roles — possibly empty.
  warehouseIds: string[] | null;
  // Subset of warehouseIds where that per-warehouse role is Staff, for
  // resources Staff may only see their own rows of (e.g. work shifts).
  staffWarehouseIds: string[];
}

export const UNRESTRICTED_ACCESS = (
  userId: string,
  role: UserRole,
): WarehouseAccess => ({
  userId,
  role,
  warehouseIds: null,
  staffWarehouseIds: [],
});
