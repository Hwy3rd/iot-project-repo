import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

export type DeliveryStatus = 'pending' | 'sent' | 'failed' | 'expired';

@Entity('notification_deliveries')
@Index('UQ_delivery_target', ['notificationId', 'subscriptionId'], {
  unique: true,
})
@Index('IDX_delivery_due', ['status', 'nextAttemptAt'])
export class NotificationDelivery {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @Column({ type: 'varchar', length: 36, name: 'notification_id' })
  notificationId!: string;

  // Keep the ID after an endpoint is deleted; never retain its credentials.
  @Column({ type: 'varchar', length: 36, name: 'subscription_id' })
  subscriptionId!: string;

  @Column({
    type: 'enum',
    enum: ['pending', 'sent', 'failed', 'expired'],
    default: 'pending',
  })
  status!: DeliveryStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'datetime', name: 'next_attempt_at' })
  nextAttemptAt!: Date;

  @Column({ type: 'datetime', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'varchar', length: 36, name: 'lease_token', nullable: true })
  leaseToken!: string | null;

  @Column({ type: 'datetime', name: 'sent_at', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'varchar', length: 255, name: 'last_error', nullable: true })
  lastError!: string | null;
}
