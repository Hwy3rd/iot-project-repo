import { IsEnum, Matches } from 'class-validator';
import { ShiftType } from '../../../libs/constants/shift.constant';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

export class CreateShiftDto {
  @IsEnum(ShiftType)
  shiftType!: ShiftType;

  @Matches(TIME_PATTERN, {
    message: 'startTime must be in HH:mm or HH:mm:ss format',
  })
  startTime!: string;

  @Matches(TIME_PATTERN, {
    message: 'endTime must be in HH:mm or HH:mm:ss format',
  })
  endTime!: string;
}
