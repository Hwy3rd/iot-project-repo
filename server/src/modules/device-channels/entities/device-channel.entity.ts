import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import {
  ChannelRole,
  ChannelType,
} from '../../../libs/constants/device-channel.constant';
import { Device } from '../../devices/entities/device.entity';

// One row per peripheral wired to a single ESP32 (Device): a limit switch,
// a temp/humidity sensor, a fan motor, etc. Multiple channels of the same
// type on one device are allowed (e.g. two fans), hence no unique
// constraint on (deviceId, channelType).
@Entity('device_channels')
export class DeviceChannel {
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

  @Column({ type: 'enum', enum: ChannelType, name: 'channel_type' })
  channelType!: ChannelType;

  @Column({ type: 'enum', enum: ChannelRole, name: 'channel_role' })
  channelRole!: ChannelRole;

  // e.g. "fan 1", "door 2" — to disambiguate multiple channels of the same
  // type on one device.
  @Column({ type: 'varchar', nullable: true })
  label!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
