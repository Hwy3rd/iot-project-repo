import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { UserRole } from '../../libs/constants/user.constant';
import { WorkShiftStatus } from '../../libs/constants/work-shift.constant';
import { WarehouseStaff } from '../../modules/warehouses/entities/warehouse-staff.entity';
import { WorkShift } from '../../modules/work-shifts/entities/work-shift.entity';
import { activeShiftCutoff } from '../../modules/work-shifts/work-shift-schedule';
import { UNRESTRICTED_ACCESS, WarehouseAccess } from './warehouse-access';

// Single source of truth for "which warehouses may this caller read, for an
// action allowed to `allowedRoles`" (docs/RBAC.md §3). Used by WarehouseScopeGuard for REST list routes and by
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

  // Admin: unrestricted. Everyone else: the warehouses they're assigned to
  // if their role is in `allowedRoles` (any role when it's empty/undefined),
  // else none; with `requireShift`, Staff only get the warehouses they're
  // checked into a shift at.
  async resolve(
    user: { id: string; role: UserRole },
    allowedRoles: UserRole[] | undefined,
    options: { requireShift?: boolean } = {},
  ): Promise<WarehouseAccess> {
    if (user.role === UserRole.ADMIN) {
      return UNRESTRICTED_ACCESS(user.id, user.role);
    }

    const none = { userId: user.id, role: user.role, warehouseIds: [] };
    if (allowedRoles?.length && !allowedRoles.includes(user.role)) {
      return { ...none, staffWarehouseIds: [] };
    }

    const assignments = await this.warehouseStaffRepo.find({
      where: { userId: user.id },
    });
    let warehouseIds = assignments.map((a) => a.warehouseId);
    if (user.role !== UserRole.STAFF) {
      return { ...none, warehouseIds, staffWarehouseIds: [] };
    }
    if (options.requireShift && warehouseIds.length > 0) {
      warehouseIds = await this.warehousesWithActiveShift(
        user.id,
        warehouseIds,
      );
    }
    return { ...none, warehouseIds, staffWarehouseIds: warehouseIds };
  }

  // Warehouses (among `warehouseIds`) where the user is working a shift
  // right now: check-in approved by a Manager, not checked out, and the
  // shift not over (plus the grace period after it — activeShiftCutoff).
  async warehousesWithActiveShift(
    userId: string,
    warehouseIds: string[],
    now = new Date(),
  ): Promise<string[]> {
    if (warehouseIds.length === 0) return [];
    const shifts = await this.workShiftRepo.find({
      where: {
        staffId: userId,
        warehouseId: In(warehouseIds),
        status: WorkShiftStatus.APPROVED,
        checkOutAt: IsNull(),
        scheduledEndAt: MoreThan(activeShiftCutoff(now)),
      },
    });
    return [...new Set(shifts.map((shift) => shift.warehouseId))];
  }
}
