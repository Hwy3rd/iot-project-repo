import { IsNotEmpty, IsString } from 'class-validator';
import { CreateMessageDto } from './create-message.dto';

// Socket counterpart of POST :id/messages — the conversation id travels in
// the payload instead of the URL. Same content rules (CreateMessageDto).
export class SendChatbotMessageDto extends CreateMessageDto {
  @IsNotEmpty()
  @IsString()
  conversationId!: string;
}
