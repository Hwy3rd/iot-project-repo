import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { DeviceStatus } from '../../../libs/constants/device.constant';
import { ColdRoom } from '../../cold-rooms/entities/cold-room.entity';

// No onDelete cascade on cold_room_id: soft-deleting a cold room must not
// destroy the physical device record, and a decommissioned device should
// still be visible for asset tracking even once unassigned.
@Entity('devices')
export class Device {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', name: 'unique_id', unique: true })
  uniqueId!: string;

  @Column({
    type: 'varchar',
    name: 'cold_room_id',
    length: 36,
    nullable: true,
  })
  coldRoomId!: string | null;

  @ManyToOne(() => ColdRoom, { nullable: true })
  @JoinColumn({ name: 'cold_room_id' })
  coldRoom!: ColdRoom | null;

  @Column({ type: 'varchar', name: 'firmware_version', nullable: true })
  firmwareVersion!: string | null;

  @Column({
    type: 'enum',
    enum: DeviceStatus,
    default: DeviceStatus.REGISTERED,
  })
  status!: DeviceStatus;

  @Column({ type: 'timestamp', name: 'last_heartbeat_at', nullable: true })
  lastHeartbeatAt!: Date | null;

  // Never exposed in any response DTO — only the hash is persisted, the
  // plaintext code is returned once from generateClaimCode() and discarded.
  @Column({ type: 'varchar', name: 'claim_code_hash', nullable: true })
  claimCodeHash!: string | null;

  @Column({
    type: 'timestamp',
    name: 'claim_code_expires_at',
    nullable: true,
  })
  claimCodeExpiresAt!: Date | null;

  @Column({ type: 'timestamp', name: 'claimed_at', nullable: true })
  claimedAt!: Date | null;

  @Column({ type: 'timestamp', name: 'decommissioned_at', nullable: true })
  decommissionedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
