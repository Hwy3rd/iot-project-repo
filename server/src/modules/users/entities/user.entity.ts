import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { UserRole, UserStatus } from '../../../libs/constants/user.constant';

@Entity('users')
export class User {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', unique: true })
  username!: string;

  @Column({ type: 'varchar', unique: true, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone!: string | null;

  @Column({ type: 'varchar', name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'varchar', name: 'full_name', nullable: true })
  fullName!: string | null;

  @Column({ type: 'json', name: 'image_urls', nullable: true })
  imageUrls!: string[] | null;

  @Index()
  @Column({ type: 'enum', enum: UserRole })
  role!: UserRole;

  @Index()
  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  @Column({
    type: 'timestamp',
    name: 'password_changed_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  passwordChangedAt!: Date;

  @Column({ type: 'timestamp', name: 'last_login_at', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
