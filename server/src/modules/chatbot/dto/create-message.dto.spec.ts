import { ValidationPipe } from '@nestjs/common';
import { CHATBOT_MESSAGE_MAX_LENGTH } from '../../../libs/constants/chatbot.constant';
import { CreateMessageDto } from './create-message.dto';

describe('CreateMessageDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true });
  const validate = (content: string) =>
    pipe.transform({ content }, { type: 'body', metatype: CreateMessageDto });

  it('accepts a message at the length limit', async () => {
    await expect(
      validate('a'.repeat(CHATBOT_MESSAGE_MAX_LENGTH)),
    ).resolves.toBeDefined();
  });

  it('rejects a message over the length limit', async () => {
    await expect(
      validate('a'.repeat(CHATBOT_MESSAGE_MAX_LENGTH + 1)),
    ).rejects.toThrow();
  });
});
