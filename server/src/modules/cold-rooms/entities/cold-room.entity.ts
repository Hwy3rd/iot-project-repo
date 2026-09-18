import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { Warehouse } from '../../warehouses/entities/warehouse.entity';

const decimalTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : parseFloat(value),
};

@Entity('cold_rooms')
@Unique(['warehouseId', 'name'])
export class ColdRoom {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', name: 'warehouse_id', length: 36 })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, (warehouse) => warehouse.coldRooms)
  @JoinColumn({ name: 'warehouse_id' })
  warehouse!: Warehouse;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({
    type: 'decimal',
    name: 'temp_min',
    precision: 5,
    scale: 2,
    transformer: decimalTransformer,
  })
  tempMin!: number;

  @Column({
    type: 'decimal',
    name: 'temp_max',
    precision: 5,
    scale: 2,
    transformer: decimalTransformer,
  })
  tempMax!: number;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 1,
    transformer: decimalTransformer,
  })
  hysteresis!: number;

  @Column({ type: 'int', name: 'door_open_max_seconds', default: 15 })
  doorOpenMaxSeconds!: number;

  // Nullable: a room only tracks the capacity unit(s) relevant to what it
  // stores (pallet-racked goods vs. loose stock weighed or measured by volume).
  @Column({ type: 'int', name: 'capacity_pallets', nullable: true })
  capacityPallets!: number | null;

  @Column({
    type: 'decimal',
    name: 'capacity_weight_kg',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  capacityWeightKg!: number | null;

  @Column({
    type: 'decimal',
    name: 'capacity_volume_m3',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  capacityVolumeM3!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
