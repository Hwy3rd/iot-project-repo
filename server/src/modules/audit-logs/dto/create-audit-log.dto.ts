import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAuditLogDto {
  // Omit for system actions / unknown-username login failures.
  @IsOptional()
  @IsString()
  @MinLength(1)
  userId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsString()
  @MinLength(1)
  action!: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
