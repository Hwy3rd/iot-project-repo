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
import { BatchStatus } from '../../../libs/constants/batch.constant';
import { ColdRoom } from '../../cold-rooms/entities/cold-room.entity';
import { ProductType } from '../../product-types/entities/product-type.entity';

const decimalTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : parseFloat(value),
};

// No deleted_at here: removed_at already represents "no longer active stock"
// for this entity, so there's no separate archive concept to soft-delete.
@Entity('batches')
@Unique(['coldRoomId', 'batchCode'])
export class Batch {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', name: 'cold_room_id', length: 36 })
  coldRoomId!: string;

  @ManyToOne(() => ColdRoom)
  @JoinColumn({ name: 'cold_room_id' })
  coldRoom!: ColdRoom;

  @Column({ type: 'varchar', name: 'product_type_id', length: 36 })
  productTypeId!: string;

  @ManyToOne(() => ProductType)
  @JoinColumn({ name: 'product_type_id' })
  productType!: ProductType;

  @Column({ type: 'varchar', name: 'batch_code' })
  batchCode!: string;

  // Measured in whatever unit productType.unit declares (kg, liter, piece,
  // box) — not necessarily weight, despite the decimal type.
  @Column({
    type: 'decimal',
    name: 'quantity',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  quantity!: number;

  @Column({ type: 'varchar', nullable: true })
  supplier!: string | null;

  @Column({ type: 'date', name: 'received_at' })
  receivedAt!: string;

  @Column({ type: 'date', name: 'expiry_date' })
  expiryDate!: string;

  @Column({ type: 'date', name: 'removed_at', nullable: true })
  removedAt!: string | null;

  @Column({
    type: 'enum',
    enum: BatchStatus,
    default: BatchStatus.IN_STOCK,
  })
  status!: BatchStatus;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
