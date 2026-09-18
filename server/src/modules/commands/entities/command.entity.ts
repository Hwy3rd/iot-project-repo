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
import {
  CommandAction,
  CommandStatus,
} from '../../../libs/constants/command.constant';
import { DeviceChannel } from '../../device-channels/entities/device-channel.entity';
import { User } from '../../users/entities/user.entity';

// No onDelete cascade on either FK: command history must survive the
// channel or the issuing user being removed, for audit purposes.
@Entity('commands')
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

  @Column({ type: 'timestamp', name: 'ack_at', nullable: true })
  ackAt!: Date | null;
}
