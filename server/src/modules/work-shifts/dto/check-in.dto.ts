import { IsString, MinLength } from 'class-validator';

// The shift itself isn't sent: the server picks it from the time of the
// request (see work-shift-schedule.ts openShiftAt()).
export class CheckInDto {
  @IsString()
  @MinLength(1)
  warehouseId!: string;
}
