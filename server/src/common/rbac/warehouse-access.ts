import { UserRole } from '../../libs/constants/user.constant';

// Which warehouses a caller may read on a list endpoint — computed by
// WarehouseScopeGuard for routes marked @WarehouseListScope() and handed to
// the controller via @ScopedWarehouses(). Services turn it into a WHERE
// clause, so list results match what the per-resource routes would allow.
export interface WarehouseAccess {
  userId: string;
  role: UserRole;
  // null = unrestricted (Admin). Otherwise the warehouses the caller is
  // assigned to, or none when their role isn't one of the route's @Roles.
  warehouseIds: string[] | null;
  // warehouseIds again when the caller is Staff (else empty), for
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
