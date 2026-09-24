import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CHATBOT_MESSAGE_MAX_LENGTH } from '../../../libs/constants/chatbot.constant';

// Role is deliberately not a field here — this DTO is only ever used for
// the client-facing "send a message" endpoint, which always writes
// role=USER server-side (see ChatbotController.addMessage). A client can
// never forge an ASSISTANT/TOOL row through this DTO.
export class CreateMessageDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(CHATBOT_MESSAGE_MAX_LENGTH, {
    message: `Tin nhắn tối đa ${CHATBOT_MESSAGE_MAX_LENGTH} ký tự`,
  })
  content!: string;
}
