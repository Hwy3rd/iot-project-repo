import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { MessageRole } from '../../../libs/constants/chatbot.constant';
import { Conversation } from './conversation.entity';

// One row per turn in a conversation, including tool-calling turns — not
// just the human-readable exchange. An ASSISTANT row that requests tools
// carries them in `toolCalls` and may have `content: null` (model asked for
// data before saying anything); the matching TOOL row that answers each
// call carries the same id in `toolCallId` so the pair can be replayed back
// to the LLM in order on the next turn.
//
// No FK/relation onto Alert/Device/Batch/etc: a TOOL row's `content` is a
// point-in-time snapshot of whatever the tool returned (already scoped to
// the conversation owner's warehouse access and redacted of sensitive
// fields by the caller), not live data — this table's rows get replayed
// straight into the next LLM request, so nothing should be written here
// that shouldn't leave the system a second time.
@Entity('chatbot_messages')
@Index(['conversationId', 'createdAt'])
export class Message {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id!: string;

  @BeforeInsert()
  generateId() {
    this.id ??= uuidv7();
  }

  @Column({ type: 'varchar', name: 'conversation_id', length: 36 })
  conversationId!: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;

  @Column({ type: 'enum', enum: MessageRole })
  role!: MessageRole;

  // Null for an ASSISTANT row that is purely a tool-call request.
  @Column({ type: 'text', nullable: true })
  content!: string | null;

  // Set only on ASSISTANT rows that request one or more tool calls,
  // mirroring the LLM API's own tool_calls shape so it can be forwarded
  // back verbatim on the next request.
  @Column({ type: 'json', name: 'tool_calls', nullable: true })
  toolCalls!: Array<{ id: string; name: string; arguments: unknown }> | null;

  // Set only on TOOL rows: the tool_calls[].id from the ASSISTANT row this
  // result answers.
  @Column({
    type: 'varchar',
    name: 'tool_call_id',
    length: 64,
    nullable: true,
  })
  toolCallId!: string | null;

  // Set only on TOOL rows, denormalized off toolCalls purely so a message
  // list can be rendered/debugged without cross-referencing the assistant
  // row above it.
  @Column({ type: 'varchar', name: 'tool_name', length: 100, nullable: true })
  toolName!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
