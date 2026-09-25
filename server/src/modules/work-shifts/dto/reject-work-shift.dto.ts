import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectWorkShiftDto {
  // Shown to the Staff member on their check-in screen.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
