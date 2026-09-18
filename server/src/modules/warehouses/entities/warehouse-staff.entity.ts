import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { UserRole } from '../../../libs/constants/user.constant';
import { User } from '../../users/entities/user.entity';
import { Warehouse } from './warehouse.entity';

// One row per (user, warehouse) assignment. `role` reuses the same UserRole
// enum as User.role, but scoped to this warehouse — a user's role here can
// differ from their global account role.
@Entity('warehouse_staff')
export class WarehouseStaff {
  @PrimaryColumn({ type: 'varchar', name: 'user_id', length: 36 })
  userId!: string;

  @PrimaryColumn({ type: 'varchar', name: 'warehouse_id', length: 36 })
  warehouseId!: string;

  @Column({ type: 'enum', enum: UserRole })
  role!: UserRole;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Warehouse, (warehouse) => warehouse.staff, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse!: Warehouse;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
