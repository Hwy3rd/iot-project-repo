import { Expose } from 'class-transformer';
import { MessageRole } from '../../../libs/constants/chatbot.constant';

export class MessageResponseDto {
  @Expose()
  id!: string;

  @Expose()
  conversationId!: string;

  @Expose()
  role!: MessageRole;

  @Expose()
  content!: string | null;

  @Expose()
  toolCalls!: Array<{ id: string; name: string; arguments: unknown }> | null;

  @Expose()
  toolCallId!: string | null;

  @Expose()
  toolName!: string | null;

  @Expose()
  createdAt!: Date;
}
