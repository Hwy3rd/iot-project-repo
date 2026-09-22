import { Expose } from 'class-transformer';
import {
  AlertResolution,
  AlertStatus,
  AlertType,
} from '../../../libs/constants/alert.constant';

export class AlertResponseDto {
  @Expose()
  id!: string;

  @Expose()
  coldRoomId!: string;

  @Expose()
  deviceId!: string | null;

  @Expose()
  batchId!: string | null;

  @Expose()
  type!: AlertType;

  @Expose()
  status!: AlertStatus;

  @Expose()
  triggerValue!: number | null;

  @Expose()
  threshold!: number | null;

  @Expose()
  details!: Record<string, unknown> | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  acknowledgedBy!: string | null;

  @Expose()
  acknowledgedAt!: Date | null;

  @Expose()
  resolvedBy!: string | null;

  @Expose()
  resolvedAt!: Date | null;

  @Expose()
  resolution!: AlertResolution | null;

  @Expose()
  updatedAt!: Date;
}
