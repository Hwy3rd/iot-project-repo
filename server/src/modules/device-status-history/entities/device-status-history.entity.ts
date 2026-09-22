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
  DeviceStatus,
  DeviceStatusChangeTrigger,
} from '../../../libs/constants/device.constant';
import { Device } from '../../devices/entities/device.entity';
import { User } from '../../users/entities/user.entity';

// Append-only log of every time a device's status actually changed — the
// source of truth for "when did this device change state and why", which
// `devices.status` (current value only, overwritten in place) cannot answer.
// Not written yet: DevicesService's claim()/decommission()/etc. don't call
// DeviceStatusHistoryService.record() yet — this is the entity/module only,
// wiring is a separate follow-up.
//
// No onDelete cascade on either FK: this history must survive the device or
// the acting user being removed later, same reasoning as Alert's FKs.
@Entity('device_status_history')
@Index(['deviceId', 'changedAt'])
export class DeviceStatusHistory {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', name: 'device_id', length: 36 })
  deviceId!: string;

  @ManyToOne(() => Device)
  @JoinColumn({ name: 'device_id' })
  device!: Device;

  // Null only for a device's very first entry (created straight into
  // REGISTERED — there is no prior status to record).
  @Column({
    type: 'enum',
    enum: DeviceStatus,
    name: 'old_status',
    nullable: true,
  })
  oldStatus!: DeviceStatus | null;

  @Column({ type: 'enum', enum: DeviceStatus, name: 'new_status' })
  newStatus!: DeviceStatus;

  // Null when trigger = AUTOMATED — no person to attribute the change to.
  @Column({ type: 'varchar', name: 'changed_by', length: 36, nullable: true })
  changedBy!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'changed_by' })
  changer!: User | null;

  @Column({ type: 'enum', enum: DeviceStatusChangeTrigger })
  trigger!: DeviceStatusChangeTrigger;

  @Column({ type: 'varchar', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ name: 'changed_at' })
  changedAt!: Date;
}
