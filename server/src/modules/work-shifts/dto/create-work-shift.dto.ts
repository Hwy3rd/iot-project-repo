import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreateWorkShiftDto {
  @IsString()
  @MinLength(1)
  shiftId!: string;

  @IsString()
  @MinLength(1)
  staffId!: string;

  @IsString()
  @MinLength(1)
  warehouseId!: string;

  @IsDateString()
  workDate!: string;
}
