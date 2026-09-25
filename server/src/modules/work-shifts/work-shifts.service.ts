import {
  BadRequestException,
  ConflictException,
  Injectable,
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
import { FindOptionsWhere, In, QueryFailedError, Repository } from 'typeorm';
import { WorkShiftStatus } from '../../libs/constants/work-shift.constant';
import { Shift } from '../shifts/entities/shift.entity';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { CreateWorkShiftDto } from './dto/create-work-shift.dto';
import { UpdateWorkShiftDto } from './dto/update-work-shift.dto';
import { WorkShift } from './entities/work-shift.entity';
import {
  assertInScope,
  bulkDelete,
  BulkDeleteResult,
} from '../../common/bulk/bulk-delete';

@Injectable()
export class WorkShiftsService {
  constructor(
    @InjectRepository(WorkShift)
    private readonly workShiftsRepository: Repository<WorkShift>,
    @InjectRepository(Shift)
    private readonly shiftsRepository: Repository<Shift>,
    @InjectRepository(Warehouse)
    private readonly warehousesRepository: Repository<Warehouse>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(WarehouseStaff)
    private readonly warehouseStaffRepository: Repository<WarehouseStaff>,
  ) {}

  private async assertStaffAssignedToWarehouse(
    staffId: string,
    warehouseId: string,
  ) {
    const assignment = await this.warehouseStaffRepository.findOne({
      where: { userId: staffId, warehouseId },
    });
    if (!assignment) {
      throw new BadRequestException(
        `Staff ${staffId} is not assigned to warehouse ${warehouseId}`,
      );
    }
  }

  private combineDateAndTime(date: string, time: string): Date {
    const normalizedTime = time.length === 5 ? `${time}:00` : time;
    return new Date(`${date}T${normalizedTime}Z`);
  }

  // Snapshots the template's start/end time onto workDate. If endTime <=
  // startTime the shift crosses midnight (e.g. a 22:00-06:00 night shift),
  // so the end lands on the following day.
  private computeSchedule(workDate: string, shift: Shift) {
    const scheduledStartAt = this.combineDateAndTime(workDate, shift.startTime);
    let scheduledEndAt = this.combineDateAndTime(workDate, shift.endTime);
    if (scheduledEndAt <= scheduledStartAt) {
      scheduledEndAt = new Date(scheduledEndAt.getTime() + 24 * 60 * 60 * 1000);
    }
    return { scheduledStartAt, scheduledEndAt };
  }

  private async findShiftOrThrow(shiftId: string) {
    const shift = await this.shiftsRepository.findOne({
      where: { id: shiftId },
    });
    if (!shift) {
      throw new NotFoundException(`Shift ${shiftId} not found`);
    }
    return shift;
  }

  private async saveWorkShift(workShift: WorkShift): Promise<WorkShift> {
    try {
      return await this.workShiftsRepository.save(workShift);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException(
          'This staff already has a work shift for this shift template on this date',
        );
      }
      throw error;
    }
  }

  async create(createWorkShiftDto: CreateWorkShiftDto) {
    const warehouse = await this.warehousesRepository.findOne({
      where: { id: createWorkShiftDto.warehouseId },
    });
    if (!warehouse) {
      throw new NotFoundException(
        `Warehouse ${createWorkShiftDto.warehouseId} not found`,
      );
    }

    const staff = await this.usersRepository.findOne({
      where: { id: createWorkShiftDto.staffId },
    });
    if (!staff) {
      throw new NotFoundException(
        `Staff ${createWorkShiftDto.staffId} not found`,
      );
    }

    await this.assertStaffAssignedToWarehouse(
      createWorkShiftDto.staffId,
      createWorkShiftDto.warehouseId,
    );

    const shift = await this.findShiftOrThrow(createWorkShiftDto.shiftId);
    const { scheduledStartAt, scheduledEndAt } = this.computeSchedule(
      createWorkShiftDto.workDate,
      shift,
    );

    const workShift = this.workShiftsRepository.create({
      shiftId: createWorkShiftDto.shiftId,
      staffId: createWorkShiftDto.staffId,
      warehouseId: createWorkShiftDto.warehouseId,
      workDate: createWorkShiftDto.workDate,
      scheduledStartAt,
      scheduledEndAt,
      status: WorkShiftStatus.SCHEDULED,
    });
    return this.saveWorkShift(workShift);
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

  async update(id: string, updateWorkShiftDto: UpdateWorkShiftDto) {
    const workShift = await this.findOne(id);

    // Reassigning to another staff member: they must work in this shift's
    // (fixed) warehouse.
    if (updateWorkShiftDto.staffId) {
      await this.assertStaffAssignedToWarehouse(
        updateWorkShiftDto.staffId,
        workShift.warehouseId,
      );
    }

    let scheduleUpdate: Partial<WorkShift> = {};
    if (updateWorkShiftDto.shiftId || updateWorkShiftDto.workDate) {
      const shiftId = updateWorkShiftDto.shiftId ?? workShift.shiftId;
      const shift = await this.findShiftOrThrow(shiftId);
      const workDate = updateWorkShiftDto.workDate ?? workShift.workDate;
      scheduleUpdate = this.computeSchedule(workDate, shift);
    }

    Object.assign(workShift, updateWorkShiftDto, scheduleUpdate);
    return this.saveWorkShift(workShift);
  }

  async checkIn(id: string) {
    const workShift = await this.findOne(id);
    if (workShift.status !== WorkShiftStatus.SCHEDULED) {
      throw new ConflictException(
        `Work shift ${id} cannot be checked in from status ${workShift.status}`,
      );
    }
    workShift.checkInAt = new Date();
    workShift.status = WorkShiftStatus.CHECKED_IN;
    return this.workShiftsRepository.save(workShift);
  }

  async checkOut(id: string) {
    const workShift = await this.findOne(id);
    if (workShift.status !== WorkShiftStatus.CHECKED_IN) {
      throw new ConflictException(
        `Work shift ${id} cannot be checked out from status ${workShift.status}`,
      );
    }
    workShift.checkOutAt = new Date();
    workShift.status = WorkShiftStatus.COMPLETED;
    return this.workShiftsRepository.save(workShift);
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
}
