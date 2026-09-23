import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { User } from '../../users/entities/user.entity';

// One row per chat thread between a user and the assistant. `lastMessageAt`
// is denormalized here (rather than derived via a join/sort on Message)
// purely so the conversation list can be sorted and paginated with a single
// indexed query — kept in sync by ChatbotService.appendMessage whenever a
// message is written, the same reasoning as Alert's own status fields.
@Entity('chatbot_conversations')
@Index(['userId', 'lastMessageAt'])
export class Conversation {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', name: 'user_id', length: 36 })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // Nullable: set from a preview of the first user message once one
  // exists (see ChatbotService.addUserMessage), left null for a brand-new
  // empty conversation.
  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamp', name: 'last_message_at', nullable: true })
  lastMessageAt!: Date | null;
}
