import { Expose, Transform } from 'class-transformer';
import { WorkShiftStatus } from '../../../libs/constants/work-shift.constant';
import { lateMinutes } from '../work-shift-schedule';
import type { WorkShift } from '../entities/work-shift.entity';

export class WorkShiftResponseDto {
  @Expose()
  id!: string;

  @Expose()
  shiftId!: string;

  @Expose()
  staffId!: string;

  @Expose()
  warehouseId!: string;

  @Expose()
  workDate!: string;

  @Expose()
  scheduledStartAt!: Date;

  @Expose()
  scheduledEndAt!: Date;

  @Expose()
  status!: WorkShiftStatus;

  @Expose()
  checkInAt!: Date | null;

  // Computed: minutes checkInAt came after scheduledStartAt (0 = on time).
  @Expose()
  @Transform(({ obj }: { obj: WorkShift }) =>
    lateMinutes(obj.checkInAt, obj.scheduledStartAt),
  )
  lateMinutes!: number | null;

  @Expose()
  checkOutAt!: Date | null;

  @Expose()
  reviewedBy!: string | null;

  @Expose()
  reviewedAt!: Date | null;

  @Expose()
  rejectReason!: string | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}
