import { Expose } from 'class-transformer';
import { BatchStatus } from '../../../libs/constants/batch.constant';

export class BatchResponseDto {
  @Expose()
  id!: string;

  @Expose()
  coldRoomId!: string;

  @Expose()
  productTypeId!: string;

  @Expose()
  batchCode!: string;

  @Expose()
  quantity!: number;

  @Expose()
  supplier!: string | null;

  @Expose()
  receivedAt!: string;

  @Expose()
  expiryDate!: string;

  @Expose()
  removedAt!: string | null;

  @Expose()
  status!: BatchStatus;

  @Expose()
  notes!: string | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  updatedAt!: Date;
}
