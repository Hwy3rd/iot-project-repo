import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

// A reusable shift template (e.g. "Ca sáng: 06:00-14:00") — not tied to any
// staff member or date; a WorkShift is one Staff member's check-in to one
// occurrence of it. Admins create as many as they like, but the active
// templates' hours never overlap within the day (ShiftsService), so a
// moment of the day belongs to at most one shift.
//
// `name` is unique among active templates only, checked by ShiftsService:
// a DB unique index would also count soft-deleted ones and block reusing
// the name of a deleted template.
@Entity('shifts')
export class Shift {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'time', name: 'start_time' })
  startTime!: string;

  @Column({ type: 'time', name: 'end_time' })
  endTime!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
