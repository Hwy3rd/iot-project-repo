import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { NotificationStatus } from '../../../libs/constants/notification.constant';
import { Alert } from '../../alerts/entities/alert.entity';
import { User } from '../../users/entities/user.entity';

// One row per (alert, recipient) — the delivery record, not the incident
// itself (that's Alert; see alerts.service.ts's header comment for the
// event-vs-delivery split this follows). Created by
// AlertNotificationProcessor when a *new* alert is raised (not on a
// refresh of an already-open one — see AlertsService.raise), one per user
// in the alert's warehouse. Fans out to every one of that user's
// PushSubscription rows; `status`/`sentAt` describe the notification as a
// whole, not any single subscription's delivery.
//
// `title`/`body` are a snapshot of what was actually sent, composed once at
// dispatch time — not derived live from the alert, so the record stays
// meaningful even after the alert's own state has moved on (acknowledged,
// resolved, or, in principle, a cold room renamed later).
@Entity('notifications')
@Index(['userId', 'readAt'])
export class Notification {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', name: 'user_id', length: 36 })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // Nullable so this table can carry a non-alert notification later (e.g.
  // "your account was locked") without a schema change — none exist yet.
  @Column({ type: 'varchar', name: 'alert_id', length: 36, nullable: true })
  alertId!: string | null;

  @ManyToOne(() => Alert, { nullable: true })
  @JoinColumn({ name: 'alert_id' })
  alert!: Alert | null;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.PENDING,
  })
  status!: NotificationStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  // Set once the push has been handed to at least one of the user's
  // subscriptions successfully (see AlertNotificationProcessor).
  @Column({ type: 'timestamp', name: 'sent_at', nullable: true })
  sentAt!: Date | null;

  // Set by the client — a web push payload itself carries no read receipt,
  // the service worker's `notificationclick` handler is expected to call
  // POST /notifications/:id/read.
  @Column({ type: 'timestamp', name: 'read_at', nullable: true })
  readAt!: Date | null;
}
