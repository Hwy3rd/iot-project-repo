import { Expose } from 'class-transformer';

// p256dhKey/authKey are deliberately not exposed — the client never needs to
// read them back, only the server uses them when sending.
export class PushSubscriptionResponseDto {
  @Expose()
  id!: string;

  @Expose()
  userId!: string;

  @Expose()
  endpoint!: string;

  @Expose()
  userAgent!: string | null;

  @Expose()
  createdAt!: Date;

  @Expose()
  lastUsedAt!: Date | null;
}
