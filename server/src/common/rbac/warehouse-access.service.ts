import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseStaff } from '../../modules/warehouses/entities/warehouse-staff.entity';
import { WorkShift } from '../../modules/work-shifts/entities/work-shift.entity';
import { UNRESTRICTED_ACCESS, WarehouseAccess } from './warehouse-access';

// Single source of truth for "which warehouses may this caller read, for an
// action allowed to `allowedRoles`" under the per-warehouse role model
// (docs/RBAC.md §3). Used by WarehouseScopeGuard for REST list routes and by
// the chatbot's tool executor — so a chatbot tool can never see more than
// the REST route it mirrors.
@Injectable()
export class WarehouseAccessService {
  constructor(
    @InjectRepository(WarehouseStaff)
    private readonly warehouseStaffRepo: Repository<WarehouseStaff>,
    @InjectRepository(WorkShift)
    private readonly workShiftRepo: Repository<WorkShift>,
  ) {}

  // Admin: unrestricted. Everyone else: warehouses where their
  // warehouse_staff.role is in `allowedRoles` (all assignments when it's
  // empty/undefined); with `requireShift`, a warehouse where they act as
  // Staff only counts while they're checked into a shift there.
  async resolve(
    user: { id: string; role: UserRole },
    allowedRoles: UserRole[] | undefined,
    options: { requireShift?: boolean } = {},
  ): Promise<WarehouseAccess> {
    if (user.role === UserRole.ADMIN) {
      return UNRESTRICTED_ACCESS(user.id, user.role);
    }

    const assignments = await this.warehouseStaffRepo.find({
      where: { userId: user.id },
    });
    const allowed = assignments.filter(
      (a) => !allowedRoles?.length || allowedRoles.includes(a.role),
    );

    let staffIds = allowed
      .filter((a) => a.role === UserRole.STAFF)
      .map((a) => a.warehouseId);
    const otherIds = allowed
      .filter((a) => a.role !== UserRole.STAFF)
      .map((a) => a.warehouseId);
    if (options.requireShift && staffIds.length > 0) {
      staffIds = await this.warehousesWithActiveShift(user.id, staffIds);
    }

    return {
      userId: user.id,
      role: user.role,
      warehouseIds: [...otherIds, ...staffIds],
      staffWarehouseIds: staffIds,
    };
  }

  // Every role the user holds in some warehouse (deduplicated) — e.g. to
  // decide which features to even offer them before any warehouse is known.
  async assignedRoles(userId: string): Promise<UserRole[]> {
    const assignments = await this.warehouseStaffRepo.find({
      where: { userId },
    });
    return [...new Set(assignments.map((a) => a.role))];
  }

  // Warehouses (among `warehouseIds`) where the user is checked into a
  // shift right now — checked in and not yet checked out.
  async warehousesWithActiveShift(
    userId: string,
    warehouseIds: string[],
  ): Promise<string[]> {
    if (warehouseIds.length === 0) return [];
    const shifts = await this.workShiftRepo.find({
      where: {
        staffId: userId,
        warehouseId: In(warehouseIds),
        checkInAt: Not(IsNull()),
        checkOutAt: IsNull(),
      },
    });
    return [...new Set(shifts.map((shift) => shift.warehouseId))];
  }
}
