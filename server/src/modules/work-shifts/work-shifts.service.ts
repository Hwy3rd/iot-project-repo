import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  findAll(access?: WarehouseAccess) {
    const ids = access?.warehouseIds;
    if (!ids || !access) return this.workShiftsRepository.find();

    const staffIds = new Set(access.staffWarehouseIds);
    const otherIds = ids.filter((id) => !staffIds.has(id));
    const where: FindOptionsWhere<WorkShift>[] = [];
    if (otherIds.length > 0) where.push({ warehouseId: In(otherIds) });
    if (staffIds.size > 0) {
      where.push({ warehouseId: In([...staffIds]), staffId: access.userId });
    }
    if (where.length === 0) return Promise.resolve([]);
    return this.workShiftsRepository.find({ where });
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
}
