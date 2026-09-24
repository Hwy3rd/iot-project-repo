import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../libs/redis/redis.constant';

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 24 * 60 * 60;

// Atomic INCR + EXPIRE-on-first-hit. Also repairs a key that somehow has no
// TTL (TTL returns -1), e.g. one left by the older non-atomic version.
const INCR_WITH_TTL_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('TTL', KEYS[1]) == -1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

// Per-user cap on messages that cost an LLM call, shared by both ways of
// sending one — ChatbotRateLimitGuard (REST POST :id/messages) and
// ChatbotGateway (socket chatbot:send) — so switching transport never
// resets the count. Redis-backed (not in-memory) because app/worker run as
// separate containers behind the same Redis — an in-memory counter would
// only ever see one process's traffic.
//
// Two windows, not one: the per-minute cap stops a burst (fast repeated
// clicks/retries), the per-day cap is the real cost control given Google
// AI Studio's free-tier quota is the actual constraint here (see the
// chatbot design discussion — this is a genuine risk, not theoretical).
@Injectable()
export class ChatbotRateLimiterService {
  private readonly perMinuteLimit: number;
  private readonly perDayLimit: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.perMinuteLimit = Number(
      config.get<string>('CHATBOT_RATE_LIMIT_PER_MINUTE') ?? 10,
    );
    this.perDayLimit = Number(
      config.get<string>('CHATBOT_RATE_LIMIT_PER_DAY') ?? 200,
    );
  }

  // Counts one message; throws 429 once either window is exceeded.
  async consume(userId: string): Promise<void> {
    await this.assertWithinLimit(
      `chatbot:ratelimit:min:${userId}`,
      MINUTE_SECONDS,
      this.perMinuteLimit,
      'Bạn đang gửi tin nhắn quá nhanh, vui lòng thử lại sau ít phút.',
    );
    await this.assertWithinLimit(
      `chatbot:ratelimit:day:${userId}`,
      DAY_SECONDS,
      this.perDayLimit,
      'Bạn đã đạt giới hạn số tin nhắn chatbot trong ngày hôm nay, vui lòng thử lại vào ngày mai.',
    );
  }

  // Fixed window, not a sorted-set sliding window — approximate is enough
  // here (worst case lets through up to 2x the limit right at a window
  // boundary). INCR and EXPIRE run as one Lua script: as two separate
  // calls, a crash or dropped connection between them would leave a
  // counter with no TTL, locking that user out of the chatbot forever.
  private async assertWithinLimit(
    key: string,
    windowSeconds: number,
    limit: number,
    message: string,
  ): Promise<void> {
    const count = Number(
      await this.redis.eval(
        INCR_WITH_TTL_SCRIPT,
        1,
        key,
        String(windowSeconds),
      ),
    );
    if (count > limit) {
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
