import { IsOptional, IsString, MinLength } from 'class-validator';

export class AcknowledgeAlertDto {
  // Omit when acknowledged by an automated caller rather than a person —
  // same convention as CreateCommandDto.issuedBy.
  @IsOptional()
  @IsString()
  @MinLength(1)
  userId?: string;
}
