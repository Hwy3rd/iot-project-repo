import { IsIn } from 'class-validator';
import { UserRole } from '../../../libs/constants/user.constant';

// Admin is never assigned per warehouse — the global Admin role already
// bypasses warehouse scope everywhere (see WarehouseScopeGuard).
export const ASSIGNABLE_WAREHOUSE_ROLES = [
  UserRole.MANAGER,
  UserRole.TECHNICIAN,
  UserRole.STAFF,
] as const;

export class AssignWarehouseStaffDto {
  @IsIn(ASSIGNABLE_WAREHOUSE_ROLES)
  role!: (typeof ASSIGNABLE_WAREHOUSE_ROLES)[number];
}
