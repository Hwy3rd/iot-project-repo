import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../libs/redis/redis.constant';

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 24 * 60 * 60;

// Only guards the one route that actually costs an LLM call
// (POST :id/messages) — read endpoints (list conversations/messages) are
// plain DB reads and don't need this. Redis-backed (not in-memory) because
// app/worker run as separate containers behind the same Redis — an
// in-memory counter would only ever see one process's traffic.
//
// Two windows, not one: the per-minute cap stops a burst (fast repeated
// clicks/retries), the per-day cap is the real cost control given Google
// AI Studio's free-tier quota is the actual constraint here (see the
// chatbot design discussion — this is a genuine risk, not theoretical).
@Injectable()
export class ChatbotRateLimitGuard implements CanActivate {
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

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { id: string } }>();
    const userId = request.user?.id;
    if (!userId) {
      // JwtAuthGuard already runs earlier in the global guard chain (see
      // RbacModule) and would have rejected an unauthenticated request —
      // this is just defense in depth, not the primary check.
      return true;
    }

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
    return true;
  }

  // INCR+EXPIRE, not a sorted-set sliding window — an approximate fixed
  // window is enough here (worst case lets through up to 2x the limit
  // right at a window boundary), and matches how the rest of this codebase
  // does simple Redis counters (e.g. AuthService's refresh-token TTL keys)
  // rather than reaching for a heavier rate-limit library for one route.
  private async assertWithinLimit(
    key: string,
    windowSeconds: number,
    limit: number,
    message: string,
  ): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSeconds);
    }
    if (count > limit) {
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
