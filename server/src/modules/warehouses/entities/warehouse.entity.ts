import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { ColdRoom } from '../../cold-rooms/entities/cold-room.entity';
import { WarehouseStaff } from './warehouse-staff.entity';

@Entity('warehouses')
export class Warehouse {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', unique: true })
  name!: string;

  @Column({ type: 'varchar', unique: true })
  code!: string;

  @Column({ type: 'varchar', nullable: true })
  address!: string | null;

  @Column({ type: 'json', name: 'image_urls', nullable: true })
  imageUrls!: string[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;

  @OneToMany(() => ColdRoom, (coldRoom) => coldRoom.warehouse)
  coldRooms!: ColdRoom[];

  @OneToMany(() => WarehouseStaff, (staff) => staff.warehouse)
  staff!: WarehouseStaff[];
}
