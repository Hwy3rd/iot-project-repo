import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
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

// The junction assigning a Shift template to one staff member on one date.
// scheduledStartAt/scheduledEndAt are a snapshot (workDate + the template's
// startTime/endTime) taken at creation time, so this row's schedule stays
// fixed even if the Shift template is edited later.
//
// No onDelete cascade on any FK: work-shift history must survive a staff
// member, warehouse, or shift template being soft-deleted, for
// payroll/audit purposes.
@Entity('work_shifts')
@Unique(['staffId', 'workDate', 'shiftId'])
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
    default: WorkShiftStatus.SCHEDULED,
  })
  status!: WorkShiftStatus;

  @Column({ type: 'timestamp', name: 'check_in_at', nullable: true })
  checkInAt!: Date | null;

  @Column({ type: 'timestamp', name: 'check_out_at', nullable: true })
  checkOutAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
