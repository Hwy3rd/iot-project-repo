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
import { ProductUnit } from '../../../libs/constants/product-unit.constant';

const decimalTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : parseFloat(value),
};

@Entity('product_types')
export class ProductType {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', unique: true })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  category!: string | null;

  @Column({ type: 'enum', enum: ProductUnit })
  unit!: ProductUnit;

  @Column({ type: 'json', name: 'image_urls', nullable: true })
  imageUrls!: string[] | null;

  @Column({
    type: 'decimal',
    name: 'storage_temp_min',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  storageTempMin!: number | null;

  @Column({
    type: 'decimal',
    name: 'storage_temp_max',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  storageTempMax!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
