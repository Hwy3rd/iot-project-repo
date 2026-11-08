import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

// Written in the same transaction as the alert. Redis is only a wake-up hint.
@Entity('notification_outbox')
@Index('IDX_outbox_pending', ['processedAt', 'createdAt'])
export class NotificationOutbox {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string; // alert ID; one immutable recipient/content snapshot per incident

  @Column({ type: 'json' })
  recipients!: string[];

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'datetime', name: 'processed_at', nullable: true })
  processedAt!: Date | null;
}
