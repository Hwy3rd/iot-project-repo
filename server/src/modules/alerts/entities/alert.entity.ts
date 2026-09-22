import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import {
  AlertResolution,
  AlertStatus,
  AlertType,
} from '../../../libs/constants/alert.constant';
import { Batch } from '../../batches/entities/batch.entity';
import { ColdRoom } from '../../cold-rooms/entities/cold-room.entity';
import { Device } from '../../devices/entities/device.entity';
import { User } from '../../users/entities/user.entity';

const decimalTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : parseFloat(value),
};

// One row per incident, kept forever (append-only history + current state
// in the same table — see docs/system-design.md §"Alerts"). `status` moves
// open -> acknowledged -> resolved; only AlertsService writes this table.
//
// No onDelete cascade on any FK: alert history must survive the device,
// batch, or the acknowledging/resolving user being removed later.
@Entity('alerts')
@Index(['coldRoomId', 'status', 'createdAt'])
export class Alert {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  // Snapshot of the room at the time the alert was raised, so it stays
  // correct even if the device is later moved to another room. Also the one
  // column every alert type can be scoped/filtered by, regardless of whether
  // it's about a device or a batch.
  @Column({ type: 'varchar', name: 'cold_room_id', length: 36 })
  coldRoomId!: string;

  @ManyToOne(() => ColdRoom)
  @JoinColumn({ name: 'cold_room_id' })
  coldRoom!: ColdRoom;

  // Exactly one of deviceId/batchId must be set — enforced by a CHECK
  // constraint added in the migration (TypeORM has no decorator for it).
  @Column({ type: 'varchar', name: 'device_id', length: 36, nullable: true })
  deviceId!: string | null;

  @ManyToOne(() => Device, { nullable: true })
  @JoinColumn({ name: 'device_id' })
  device!: Device | null;

  @Column({ type: 'varchar', name: 'batch_id', length: 36, nullable: true })
  batchId!: string | null;

  @ManyToOne(() => Batch, { nullable: true })
  @JoinColumn({ name: 'batch_id' })
  batch!: Batch | null;

  @Column({ type: 'enum', enum: AlertType })
  type!: AlertType;

  @Column({
    type: 'enum',
    enum: AlertStatus,
    default: AlertStatus.OPEN,
  })
  status!: AlertStatus;

  // `{type}:{deviceId|batchId}` while open/acknowledged, set back to NULL on
  // resolve. The UNIQUE index only sees non-null values (MySQL allows
  // multiple NULLs in a unique index), so this is what makes "one active
  // alert per incident" an actual DB guarantee instead of a race-prone
  // check-then-insert. See AlertsService.raise()/resolveAuto()/resolveManual().
  @Column({ type: 'varchar', name: 'active_key', unique: true, nullable: true })
  activeKey!: string | null;

  // Evidence captured at the moment the alert was raised, since the
  // threshold it was compared against (cold_room.temp_min/temp_max) can
  // change later and raw telemetry samples don't live forever.
  @Column({
    type: 'decimal',
    name: 'trigger_value',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  triggerValue!: number | null;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  threshold!: number | null;

  // Type-specific extras that don't fit a fixed column set (e.g. direction
  // "high"/"low" for temperature, doorOpenAtTrigger, door_event_id).
  @Column({ type: 'json', nullable: true })
  details!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({
    type: 'varchar',
    name: 'acknowledged_by',
    length: 36,
    nullable: true,
  })
  acknowledgedBy!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'acknowledged_by' })
  acknowledger!: User | null;

  @Column({ type: 'timestamp', name: 'acknowledged_at', nullable: true })
  acknowledgedAt!: Date | null;

  @Column({ type: 'varchar', name: 'resolved_by', length: 36, nullable: true })
  resolvedBy!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolved_by' })
  resolver!: User | null;

  @Column({ type: 'timestamp', name: 'resolved_at', nullable: true })
  resolvedAt!: Date | null;

  @Column({ type: 'enum', enum: AlertResolution, nullable: true })
  resolution!: AlertResolution | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
