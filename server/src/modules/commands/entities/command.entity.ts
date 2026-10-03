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
import {
  CommandAction,
  CommandStatus,
} from '../../../libs/constants/command.constant';
import { DeviceChannel } from '../../device-channels/entities/device-channel.entity';
import { User } from '../../users/entities/user.entity';

// No onDelete cascade on either FK: command history must survive the
// channel or the issuing user being removed, for audit purposes.
// (channel_id, status): superseding the open commands of one channel.
// (status, expires_at): the retry/expiry sweep over open commands.
@Entity('commands')
@Index(['channelId', 'status'])
@Index(['status', 'expiresAt'])
export class Command {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', name: 'channel_id', length: 36 })
  channelId!: string;

  @ManyToOne(() => DeviceChannel)
  @JoinColumn({ name: 'channel_id' })
  channel!: DeviceChannel;

  // Null when the command was issued by an automated rule rather than a
  // person (e.g. an over-temperature alert auto-triggering the buzzer).
  @Column({ type: 'varchar', name: 'issued_by', length: 36, nullable: true })
  issuedBy!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'issued_by' })
  issuer!: User | null;

  @Column({ type: 'enum', enum: CommandAction })
  action!: CommandAction;

  // Actuator-specific parameters (fan speed, buzzer pattern, light color...)
  // that don't fit a fixed column set shared across channel types.
  @Column({ type: 'json', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: CommandStatus,
    default: CommandStatus.PENDING,
  })
  status!: CommandStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  // Last successful publish to the broker (PUBACK received) — the retry
  // sweep measures its interval from here. Null while still pending.
  @Column({ type: 'timestamp', name: 'sent_at', nullable: true })
  sentAt!: Date | null;

  // Successful publishes so far, capped at COMMAND_MAX_ATTEMPTS.
  @Column({ type: 'int', default: 0 })
  attempts!: number;

  // After this the command is expired instead of (re)sent, and the device
  // refuses it too. Set once at creation, never extended by a retry.
  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', name: 'ack_at', nullable: true })
  ackAt!: Date | null;

  // Why the device reported failed (e.g. "unsupported_channel"); null
  // otherwise.
  @Column({
    type: 'varchar',
    name: 'error_reason',
    length: 255,
    nullable: true,
  })
  errorReason!: string | null;
}
