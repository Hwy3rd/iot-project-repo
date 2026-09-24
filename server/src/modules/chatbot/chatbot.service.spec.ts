import { NotFoundException } from '@nestjs/common';
import { In, IsNull, LessThan } from 'typeorm';
import { MessageRole } from '../../libs/constants/chatbot.constant';
import { ChatbotService } from './chatbot.service';

describe('ChatbotService', () => {
  let conversationsRepo: { findOne: jest.Mock };
  let messagesRepo: { find: jest.Mock; findOne: jest.Mock };
  let service: ChatbotService;

  const msg = (id: string, role: MessageRole) => ({ id, role });

  beforeEach(() => {
    conversationsRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u1' }),
    };
    messagesRepo = { find: jest.fn(), findOne: jest.fn() };
    service = new ChatbotService(
      conversationsRepo as never,
      messagesRepo as never,
    );
  });

  describe('findRecentHistory', () => {
    it('takes the newest rows and returns them oldest-first', async () => {
      messagesRepo.find.mockResolvedValue([
        msg('m3', MessageRole.USER),
        msg('m2', MessageRole.ASSISTANT),
        msg('m1', MessageRole.USER),
      ]);

      const history = await service.findRecentHistory('c1', 3);

      expect(messagesRepo.find).toHaveBeenCalledWith({
        where: {
          conversationId: 'c1',
          role: In([MessageRole.USER, MessageRole.ASSISTANT]),
          toolCalls: IsNull(),
        },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 3,
      });
      expect(history.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('starts the window at a user message, dropping a leading reply', async () => {
      messagesRepo.find.mockResolvedValue([
        msg('m5', MessageRole.USER),
        msg('m4', MessageRole.ASSISTANT),
      ]);

      const history = await service.findRecentHistory('c1', 2);

      expect(history.map((m) => m.id)).toEqual(['m5']);
    });
  });

  describe('findMessages', () => {
    it('returns the latest page in chronological order', async () => {
      messagesRepo.find.mockResolvedValue([
        msg('m2', MessageRole.ASSISTANT),
        msg('m1', MessageRole.USER),
      ]);

      const page = await service.findMessages('c1', 'u1', { limit: 2 });

      expect(page.map((m) => m.id)).toEqual(['m1', 'm2']);
    });

    it('pages back from a `before` cursor', async () => {
      const cursorTime = new Date('2026-09-24T10:00:00Z');
      messagesRepo.findOne.mockResolvedValue({
        id: 'm9',
        createdAt: cursorTime,
      });
      messagesRepo.find.mockResolvedValue([]);

      await service.findMessages('c1', 'u1', { before: 'm9' });

      expect(messagesRepo.find).toHaveBeenCalledWith({
        where: { conversationId: 'c1', createdAt: LessThan(cursorTime) },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 50,
      });
    });

    it('rejects a cursor from another conversation', async () => {
      messagesRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findMessages('c1', 'u1', { before: 'other' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
