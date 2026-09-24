import { ConflictException, HttpException } from '@nestjs/common';
import { MessageRole } from '../../libs/constants/chatbot.constant';
import { UserRole } from '../../libs/constants/user.constant';
import { ChatbotGateway } from './chatbot.gateway';

describe('ChatbotGateway', () => {
  let orchestrator: { startTurn: jest.Mock };
  let rateLimiter: { consume: jest.Mock };
  let gateway: ChatbotGateway;

  const socketOf = (tokenExpiresAt = Date.now() + 60_000) => ({
    data: {
      user: { id: 'u1', username: 'u1', role: UserRole.STAFF, tokenExpiresAt },
    },
  });
  const payload = { conversationId: 'c1', content: 'Xin chào' };

  beforeEach(() => {
    orchestrator = {
      startTurn: jest.fn().mockResolvedValue({
        userMessage: {
          id: 'm1',
          conversationId: 'c1',
          role: MessageRole.USER,
          content: 'Xin chào',
          internal: 'dropped',
        },
        completion: new Promise(() => undefined),
      }),
    };
    rateLimiter = { consume: jest.fn().mockResolvedValue(undefined) };
    gateway = new ChatbotGateway(orchestrator as never, rateLimiter as never);
  });

  it('acks with the stored user message without waiting for the reply', async () => {
    const ack = await gateway.handleSend(socketOf() as never, payload);

    expect(ack).toMatchObject({
      ok: true,
      message: { id: 'm1', content: 'Xin chào' },
    });
    expect(ack.ok && ack.message).not.toHaveProperty('internal');
    expect(rateLimiter.consume).toHaveBeenCalledWith('u1');
    expect(orchestrator.startTurn).toHaveBeenCalledWith(
      'c1',
      { id: 'u1', role: UserRole.STAFF },
      'Xin chào',
    );
  });

  it('rejects an invalid payload in the ack, before counting it', async () => {
    const ack = await gateway.handleSend(socketOf() as never, {
      conversationId: 'c1',
      content: 'x'.repeat(2001),
    });

    expect(ack).toEqual({
      ok: false,
      error: { statusCode: 400, message: ['Tin nhắn tối đa 2000 ký tự'] },
    });
    expect(rateLimiter.consume).not.toHaveBeenCalled();
  });

  it('refuses to spend an LLM call on an expired access token', async () => {
    const ack = await gateway.handleSend(
      socketOf(Date.now() - 1) as never,
      payload,
    );

    expect(ack).toMatchObject({ ok: false, error: { statusCode: 401 } });
    expect(orchestrator.startTurn).not.toHaveBeenCalled();
  });

  it('passes a rate-limit rejection through as 429', async () => {
    rateLimiter.consume.mockRejectedValue(
      new HttpException('Bạn đang gửi tin nhắn quá nhanh', 429),
    );

    const ack = await gateway.handleSend(socketOf() as never, payload);

    expect(ack).toEqual({
      ok: false,
      error: { statusCode: 429, message: 'Bạn đang gửi tin nhắn quá nhanh' },
    });
  });

  it('passes a busy conversation through as 409', async () => {
    orchestrator.startTurn.mockRejectedValue(new ConflictException('busy'));

    const ack = await gateway.handleSend(socketOf() as never, payload);

    expect(ack).toMatchObject({ ok: false, error: { statusCode: 409 } });
  });

  it('hides unexpected errors behind a generic 500', async () => {
    orchestrator.startTurn.mockRejectedValue(new Error('db password wrong'));

    const ack = await gateway.handleSend(socketOf() as never, payload);

    expect(ack).toEqual({
      ok: false,
      error: { statusCode: 500, message: 'Internal server error' },
    });
  });
});
