import { Expose } from 'class-transformer';
import { ShiftType } from '../../../libs/constants/shift.constant';

export class ShiftResponseDto {
  @Expose()
  id!: string;

  @Expose()
  shiftType!: ShiftType;

  @Expose()
  startTime!: string;

  @Expose()
  endTime!: string;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}
