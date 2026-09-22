import { IsOptional, IsString, MinLength } from 'class-validator';

export class ResolveAlertDto {
  // Omit when resolved by an automated caller rather than a person — same
  // convention as CreateCommandDto.issuedBy.
  @IsOptional()
  @IsString()
  @MinLength(1)
  userId?: string;
}
