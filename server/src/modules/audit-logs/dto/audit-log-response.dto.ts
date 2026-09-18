import { Expose } from 'class-transformer';

export class AuditLogResponseDto {
  @Expose()
  id!: string;

  @Expose()
  userId!: string;

  @Expose()
  warehouseId!: string | null;

  @Expose()
  action!: string;

  @Expose()
  targetType!: string | null;

  @Expose()
  targetId!: string | null;

  @Expose()
  metadata!: Record<string, unknown> | null;

  @Expose()
  createdAt!: Date;
}
