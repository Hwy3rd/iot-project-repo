import { ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatbotRateLimitGuard } from './chatbot-rate-limit.guard';
import { ChatbotRateLimiterService } from './chatbot-rate-limiter.service';

describe('ChatbotRateLimitGuard', () => {
  let redis: { eval: jest.Mock };
  let guard: ChatbotRateLimitGuard;

  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u1' } }) }),
  } as unknown as ExecutionContext;

  beforeEach(() => {
    redis = { eval: jest.fn().mockResolvedValue(1) };
    guard = new ChatbotRateLimitGuard(
      new ChatbotRateLimiterService(
        redis as never,
        {
          get: (key: string) =>
            key === 'CHATBOT_RATE_LIMIT_PER_MINUTE' ? '2' : '100',
        } as unknown as ConfigService,
      ),
    );
  });

  it('increments and sets the TTL in one atomic script per window', async () => {
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('EXPIRE'"),
      1,
      'chatbot:ratelimit:min:u1',
      '60',
    );
  });

  it('rejects with 429 once the per-minute count is exceeded', async () => {
    redis.eval.mockResolvedValue(3);

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
  });
});
