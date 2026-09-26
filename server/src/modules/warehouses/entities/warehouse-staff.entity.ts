import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Warehouse } from './warehouse.entity';

// One row per (user, warehouse) assignment. It only says *where* a user
// works: what they may do there is their account role (User.role), the
// same in every warehouse they're assigned to.
@Entity('warehouse_staff')
export class WarehouseStaff {
  @PrimaryColumn({ type: 'varchar', name: 'user_id', length: 36 })
  userId!: string;

  @PrimaryColumn({ type: 'varchar', name: 'warehouse_id', length: 36 })
  warehouseId!: string;

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
