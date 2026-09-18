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
import { User } from '../../users/entities/user.entity';
import { Warehouse } from '../../warehouses/entities/warehouse.entity';

// Append-only: no update()/remove() anywhere in this module. Audit history
// must never be editable, not even by an admin — that's the whole point.
// No onDelete cascade on either FK: log entries must outlive the user or
// warehouse they reference.
@Entity('audit_logs')
export class AuditLog {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', name: 'user_id', length: 36 })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // Null when the action isn't scoped to a specific warehouse (e.g. a user
  // editing their own profile).
  @Column({ type: 'varchar', name: 'warehouse_id', length: 36, nullable: true })
  warehouseId!: string | null;

  @ManyToOne(() => Warehouse, { nullable: true })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse!: Warehouse | null;

  // Convention: "<resource>.<verb>", e.g. "door.open", "batch.create",
  // "warehouse.update". A free string rather than an enum because this
  // table spans every module in the app — an enum here would need editing
  // every time any module gains a new loggable action.
  @Column({ type: 'varchar' })
  action!: string;

  // Which resource was acted upon (e.g. "batch", "warehouse",
  // "product_type") and its id — together these let you join back to the
  // source row. Null when the action has no single target entity.
  @Column({ type: 'varchar', name: 'target_type', nullable: true })
  targetType!: string | null;

  @Column({ type: 'varchar', name: 'target_id', length: 36, nullable: true })
  targetId!: string | null;

  // Free-form detail, typically { before: {...}, after: {...} } for edits.
  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
