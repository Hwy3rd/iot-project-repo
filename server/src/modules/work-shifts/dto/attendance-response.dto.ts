import { Expose, Type } from 'class-transformer';
import { WorkShiftResponseDto } from './work-shift-response.dto';

export class OpenShiftResponseDto {
  @Expose()
  shiftId!: string;

  // The shift template's name.
  @Expose()
  name!: string;

  @Expose()
  workDate!: string;

  @Expose()
  scheduledStartAt!: Date;

  @Expose()
  scheduledEndAt!: Date;
}

export class AttendanceWarehouseDto {
  @Expose()
  id!: string;

  @Expose()
  name!: string;

  @Expose()
  code!: string;
}

// GET /work-shifts/me — everything the Staff check-in screen needs.
export class AttendanceResponseDto {
  // The approved shift the caller is working right now (until its end +
  // SHIFT_END_GRACE_MINUTES), or null — null means they must check in.
  @Expose()
  @Type(() => WorkShiftResponseDto)
  active!: WorkShiftResponseDto | null;

  // The shift open for check-in at this moment, or null (between shifts).
  @Expose()
  @Type(() => OpenShiftResponseDto)
  open!: OpenShiftResponseDto | null;

  // The caller's request for `open`, whatever its status, or null if they
  // haven't sent one yet.
  @Expose()
  @Type(() => WorkShiftResponseDto)
  request!: WorkShiftResponseDto | null;

  // Warehouses where the caller's role is Staff — the ones they can check
  // in to.
  @Expose()
  @Type(() => AttendanceWarehouseDto)
  warehouses!: AttendanceWarehouseDto[];
}
