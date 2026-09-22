import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { User } from '../../users/entities/user.entity';

// One row per browser/device the user has enabled push notifications on
// (the Web Push `PushSubscription` object from `pushManager.subscribe()`
// — `endpoint`/`keys.p256dh`/`keys.auth`, nothing else from it is needed
// server-side). A user can have several — one per browser they're logged
// into. Deleted (not just marked stale) the moment the push service tells
// us the endpoint is gone — see NotificationsService.removeSubscription and
// AlertNotificationProcessor's 404/410 handling.
@Entity('push_subscriptions')
export class PushSubscription {
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

  // The subscription's push service URL — unique per browser+origin. Also
  // what a re-`subscribe()` call from the same browser after clearing site
  // data will collide on, which is what we want: upsert, not a duplicate row.
  @Column({ type: 'varchar', length: 512, unique: true })
  endpoint!: string;

  @Column({ type: 'varchar', name: 'p256dh_key' })
  p256dhKey!: string;

  @Column({ type: 'varchar', name: 'auth_key' })
  authKey!: string;

  // For the user to tell their subscriptions apart in a "manage devices" UI
  // (e.g. "Chrome on Windows"). Best-effort, sent by the client, never parsed.
  @Column({ type: 'varchar', name: 'user_agent', nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamp', name: 'last_used_at', nullable: true })
  lastUsedAt!: Date | null;
}
