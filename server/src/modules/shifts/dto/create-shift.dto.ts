import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

export class CreateShiftDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  // Wall-clock time in the business timezone (UTC+7). endTime <= startTime
  // = the shift ends the next day; equal times are refused (ShiftsService).
  @Matches(TIME_PATTERN, {
    message: 'startTime must be in HH:mm or HH:mm:ss format',
  })
  startTime!: string;

  @Matches(TIME_PATTERN, {
    message: 'endTime must be in HH:mm or HH:mm:ss format',
  })
  endTime!: string;
}
