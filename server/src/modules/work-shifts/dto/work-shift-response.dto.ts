import { Expose } from 'class-transformer';
import { WorkShiftStatus } from '../../../libs/constants/work-shift.constant';

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
