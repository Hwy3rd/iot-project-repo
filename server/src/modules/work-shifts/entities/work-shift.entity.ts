import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { WorkShiftStatus } from '../../../libs/constants/work-shift.constant';
import { Shift } from '../../shifts/entities/shift.entity';
import { User } from '../../users/entities/user.entity';
import { Warehouse } from '../../warehouses/entities/warehouse.entity';

// One attendance record: a Staff member checking in to one Shift template's
// occurrence (shiftId + workDate) at one warehouse, reviewed by a Manager.
// Created by the Staff's own check-in request — the system picks the shift
// from the time of the request (see work-shift-schedule.ts), nobody
// schedules it ahead. scheduledStartAt/scheduledEndAt are a snapshot of the
// template's times on workDate, so the record stays fixed even if the
// template is edited later. Status flow: WorkShiftStatus.
//
// Unique per (staff, date, shift): a rejected request is re-sent by
// resetting this same row, not by adding another.
//
// No onDelete cascade on any FK: work-shift history must survive a staff
// member, warehouse, or shift template being soft-deleted, for
// payroll/audit purposes.
@Entity('work_shifts')
@Unique(['staffId', 'workDate', 'shiftId'])
@Index(['warehouseId', 'workDate'])
export class WorkShift {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', name: 'shift_id', length: 36 })
  shiftId!: string;

  @ManyToOne(() => Shift)
  @JoinColumn({ name: 'shift_id' })
  shift!: Shift;

  @Column({ type: 'varchar', name: 'staff_id', length: 36 })
  staffId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'staff_id' })
  staff!: User;

  @Column({ type: 'varchar', name: 'warehouse_id', length: 36 })
  warehouseId!: string;

  @ManyToOne(() => Warehouse)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse!: Warehouse;

  @Column({ type: 'date', name: 'work_date' })
  workDate!: string;

  @Column({ type: 'timestamp', name: 'scheduled_start_at' })
  scheduledStartAt!: Date;

  @Column({ type: 'timestamp', name: 'scheduled_end_at' })
  scheduledEndAt!: Date;

  @Column({
    type: 'enum',
    enum: WorkShiftStatus,
    default: WorkShiftStatus.PENDING,
  })
  status!: WorkShiftStatus;

  // When the Staff sent the (latest) check-in request. Null only on rows
  // from before check-in requests existed.
  @Column({ type: 'timestamp', name: 'check_in_at', nullable: true })
  checkInAt!: Date | null;

  // Set when the Staff logs out at the end of the shift, or by the sweep
  // once the grace period after the shift is over.
  @Column({ type: 'timestamp', name: 'check_out_at', nullable: true })
  checkOutAt!: Date | null;

  // Manager/Admin who approved or rejected the request.
  @Column({ type: 'varchar', name: 'reviewed_by', length: 36, nullable: true })
  reviewedBy!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer!: User | null;

  @Column({ type: 'timestamp', name: 'reviewed_at', nullable: true })
  reviewedAt!: Date | null;

  @Column({
    type: 'varchar',
    name: 'reject_reason',
    length: 255,
    nullable: true,
  })
  rejectReason!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
