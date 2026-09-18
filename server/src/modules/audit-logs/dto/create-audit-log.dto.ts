import { IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAuditLogDto {
  @IsString()
  @MinLength(1)
  userId!: string;

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
