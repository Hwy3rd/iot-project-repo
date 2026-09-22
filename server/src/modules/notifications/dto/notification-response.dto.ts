import { Expose } from 'class-transformer';
import { NotificationStatus } from '../../../libs/constants/notification.constant';

export class NotificationResponseDto {
  @Expose()
  id!: string;

  @Expose()
  userId!: string;

  @Expose()
  alertId!: string | null;

  @Expose()
  title!: string;

  @Expose()
  body!: string;

  @Expose()
  status!: NotificationStatus;

  @Expose()
  createdAt!: Date;

  @Expose()
  sentAt!: Date | null;

  @Expose()
  readAt!: Date | null;
}
