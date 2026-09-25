import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { dayBetween } from '../../common/query/find-filters';
import { QueryWorkShiftDto } from './dto/query-work-shift.dto';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOptionsWhere,
  In,
  IsNull,
  MoreThan,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  USER_EVENTS,
  WorkShiftChangedEvent,
} from '../../libs/constants/realtime.constant';
import { UserRole } from '../../libs/constants/user.constant';
import { WorkShiftStatus } from '../../libs/constants/work-shift.constant';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Shift } from '../shifts/entities/shift.entity';
import { User } from '../users/entities/user.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { WorkShift } from './entities/work-shift.entity';
import { activeShiftCutoff, openShiftAt } from './work-shift-schedule';
import {
  assertInScope,
  bulkDelete,
  BulkDeleteResult,
} from '../../common/bulk/bulk-delete';

@Injectable()
export class WorkShiftsService {
  private readonly logger = new Logger(WorkShiftsService.name);

  constructor(
    @InjectRepository(WorkShift)
    private readonly workShiftsRepository: Repository<WorkShift>,
    @InjectRepository(Shift)
    private readonly shiftsRepository: Repository<Shift>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(WarehouseStaff)
    private readonly warehouseStaffRepository: Repository<WarehouseStaff>,
    private readonly realtime: RealtimeGateway,
  ) {}

  // What the Staff check-in screen shows: whether they're already working an
  // approved shift, which shift is open for check-in now, their request for
  // it, and where they may check in.
  async attendance(userId: string, now = new Date()) {
    const [active, shifts, assignments] = await Promise.all([
      this.workShiftsRepository.findOne({
        where: {
          staffId: userId,
          status: WorkShiftStatus.APPROVED,
          checkOutAt: IsNull(),
          scheduledEndAt: MoreThan(activeShiftCutoff(now)),
        },
        order: { scheduledStartAt: 'DESC' },
      }),
      this.shiftsRepository.find(),
      this.warehouseStaffRepository.find({
        where: { userId, role: UserRole.STAFF },
        relations: { warehouse: true },
        order: { createdAt: 'ASC' },
      }),
    ]);

    const open = openShiftAt(shifts, now);
    const request = open
      ? await this.workShiftsRepository.findOne({
          where: {
            staffId: userId,
            shiftId: open.shift.id,
            workDate: open.workDate,
          },
        })
      : null;

    return {
      active,
      open: open && {
        shiftId: open.shift.id,
        name: open.shift.name,
        workDate: open.workDate,
        scheduledStartAt: open.scheduledStartAt,
        scheduledEndAt: open.scheduledEndAt,
      },
      request,
      // The relation is null for a soft-deleted warehouse.
      warehouses: assignments
        .filter((a) => a.warehouse)
        .map((a) => ({
          id: a.warehouse.id,
          name: a.warehouse.name,
          code: a.warehouse.code,
        })),
    };
  }

  // A Staff member asks to work the shift open right now at `warehouseId`;
  // it stays pending until a Manager of that warehouse (or an Admin)
  // reviews it. WarehouseScopeGuard has already checked the caller's role
  // there is Staff — except for Admin, who bypasses it and is refused here.
  async checkIn(userId: string, warehouseId: string, now = new Date()) {
    const assignment = await this.warehouseStaffRepository.findOne({
      where: { userId, warehouseId },
    });
    if (assignment?.role !== UserRole.STAFF) {
      throw new BadRequestException(
        `You are not Staff of warehouse ${warehouseId}`,
      );
    }

    const open = openShiftAt(await this.shiftsRepository.find(), now);
    if (!open) {
      throw new ConflictException('No shift is open for check-in right now');
    }

    const existing = await this.workShiftsRepository.findOne({
      where: {
        staffId: userId,
        shiftId: open.shift.id,
        workDate: open.workDate,
      },
    });
    if (
      existing?.status === WorkShiftStatus.PENDING ||
      existing?.status === WorkShiftStatus.APPROVED
    ) {
      throw new ConflictException(
        `You already have a ${existing.status} request for this shift`,
      );
    }

    // A rejected (or expired) request is sent again on the same row.
    const workShift =
      existing ?? this.workShiftsRepository.create({ staffId: userId });
    Object.assign(workShift, {
      shiftId: open.shift.id,
      warehouseId,
      workDate: open.workDate,
      scheduledStartAt: open.scheduledStartAt,
      scheduledEndAt: open.scheduledEndAt,
      status: WorkShiftStatus.PENDING,
      checkInAt: now,
      checkOutAt: null,
      reviewedBy: null,
      reviewedAt: null,
      rejectReason: null,
    });
    const saved = await this.saveWorkShift(workShift);
    await this.announce(saved);
    return saved;
  }

  async approve(id: string, reviewerId: string, now = new Date()) {
    const workShift = await this.findPendingOrThrow(id);
    if (workShift.scheduledEndAt <= now) {
      throw new ConflictException(`Work shift ${id} has already ended`);
    }
    Object.assign(workShift, {
      status: WorkShiftStatus.APPROVED,
      reviewedBy: reviewerId,
      reviewedAt: now,
    });
    const saved = await this.workShiftsRepository.save(workShift);
    await this.announce(saved);
    return saved;
  }

  async reject(id: string, reviewerId: string, reason?: string) {
    const workShift = await this.findPendingOrThrow(id);
    Object.assign(workShift, {
      status: WorkShiftStatus.REJECTED,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
      rejectReason: reason?.trim() || null,
    });
    const saved = await this.workShiftsRepository.save(workShift);
    await this.announce(saved);
    return saved;
  }

  // The Staff member's own approved shift (WarehouseScopeGuard checks
  // ownership); called when they log out at the end of the shift. Ends
  // their shift permissions immediately.
  async checkOut(id: string) {
    const workShift = await this.findOne(id);
    if (workShift.status !== WorkShiftStatus.APPROVED || workShift.checkOutAt) {
      throw new ConflictException(
        `Work shift ${id} is not an approved shift in progress`,
      );
    }
    workShift.checkOutAt = new Date();
    const saved = await this.workShiftsRepository.save(workShift);
    await this.announce(saved);
    return saved;
  }

  // access omitted = unfiltered (internal callers); see WarehouseAccess.
  // In warehouses where the caller acts as Staff they only see their own
  // shifts (docs/RBAC.md: "Phạm vi (chỉ ca của mình)").
  async findAll(
    access?: WarehouseAccess,
    query: QueryWorkShiftDto = {},
  ): Promise<Paginated<WorkShift>> {
    const filters: FindOptionsWhere<WorkShift> = {};
    if (query.status) filters.status = query.status;
    if (query.shiftId) filters.shiftId = query.shiftId;
    if (query.staffId) filters.staffId = query.staffId;
    const workDate = dayBetween(query.workDateFrom, query.workDateTo);
    if (workDate) filters.workDate = workDate;

    let where: FindOptionsWhere<WorkShift> | FindOptionsWhere<WorkShift>[];
    const ids = access?.warehouseIds;
    if (ids && access) {
      const inWarehouse = (id: string) =>
        !query.warehouseId || id === query.warehouseId;
      const staffIds = new Set(access.staffWarehouseIds);
      const otherIds = ids.filter((id) => !staffIds.has(id) && inWarehouse(id));
      const ownIds = [...staffIds].filter(inWarehouse);
      const branches: FindOptionsWhere<WorkShift>[] = [];
      if (otherIds.length > 0) {
        branches.push({ ...filters, warehouseId: In(otherIds) });
      }
      // Asking for someone else's shifts can't match the Staff branch.
      if (
        ownIds.length > 0 &&
        (!query.staffId || query.staffId === access.userId)
      ) {
        branches.push({
          ...filters,
          warehouseId: In(ownIds),
          staffId: access.userId,
        });
      }
      if (branches.length === 0) return Paginated.empty(query);
      where = branches;
    } else {
      where = query.warehouseId
        ? { ...filters, warehouseId: query.warehouseId }
        : filters;
    }
    const pagination = resolvePagination(query);
    const [items, total] = await this.workShiftsRepository.findAndCount({
      where,
      order: { scheduledStartAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  async findOne(id: string) {
    const workShift = await this.workShiftsRepository.findOne({
      where: { id },
    });
    if (!workShift) {
      throw new NotFoundException(`Work shift ${id} not found`);
    }
    return workShift;
  }

  async remove(id: string) {
    const result = await this.workShiftsRepository.delete(id);
    if (!result.affected) {
      throw new NotFoundException(`Work shift ${id} not found`);
    }
  }

  // `access` comes from @WarehouseListScope() with the same roles as
  // DELETE /work-shifts/:id.
  async bulkRemove(
    ids: string[],
    access: WarehouseAccess,
  ): Promise<BulkDeleteResult> {
    const shifts = await this.workShiftsRepository.find({
      where: { id: In(ids) },
      select: { id: true, warehouseId: true },
    });
    const warehouseOf = new Map(shifts.map((w) => [w.id, w.warehouseId]));
    return bulkDelete(ids, (id) => {
      assertInScope(id, warehouseOf, access.warehouseIds);
      return this.remove(id);
    });
  }

  private async findPendingOrThrow(id: string) {
    const workShift = await this.findOne(id);
    if (workShift.status !== WorkShiftStatus.PENDING) {
      throw new ConflictException(
        `Work shift ${id} is ${workShift.status}, not pending`,
      );
    }
    return workShift;
  }

  private async saveWorkShift(workShift: WorkShift): Promise<WorkShift> {
    try {
      return await this.workShiftsRepository.save(workShift);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        // Two check-ins for the same shift raced; the other one won.
        throw new ConflictException(
          'You already have a request for this shift',
        );
      }
      throw error;
    }
  }

  // Tells the Staff member, the warehouse's Managers and every Admin that a
  // request changed, so check-in screens and review lists update. Best
  // effort: a realtime hiccup must never fail the write it follows (the
  // screens also poll as a fallback).
  private async announce(workShift: WorkShift) {
    try {
      const [managers, admins] = await Promise.all([
        this.warehouseStaffRepository.find({
          where: { warehouseId: workShift.warehouseId, role: UserRole.MANAGER },
          select: { userId: true },
        }),
        this.usersRepository.find({
          where: { role: UserRole.ADMIN },
          select: { id: true },
        }),
      ]);
      const event: WorkShiftChangedEvent = {
        workShiftId: workShift.id,
        warehouseId: workShift.warehouseId,
        staffId: workShift.staffId,
        status: workShift.status,
      };
      const recipients = new Set([
        workShift.staffId,
        ...managers.map((m) => m.userId),
        ...admins.map((a) => a.id),
      ]);
      for (const userId of recipients) {
        this.realtime.emitToUser(userId, USER_EVENTS.WORK_SHIFT_CHANGED, event);
      }
    } catch (error) {
      this.logger.warn(
        `Could not announce work shift ${workShift.id}: ${String(error)}`,
      );
    }
  }
}
