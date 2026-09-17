import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import Redis from 'ioredis';
import { Strategy } from 'passport-jwt';
import { REDIS_CLIENT } from '../../redis/redis.constant';

function extractRefreshTokenFromCookie(req: Request): string | null {
  const cookies = req?.cookies as Record<string, string> | undefined;
  return cookies?.[process.env.REFRESH_COOKIE_NAME ?? 'refresh_token'] ?? null;
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor(
    config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super({
      jwtFromRequest: extractRefreshTokenFromCookie,
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_REFRESH_SECRET')!,
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: { sub: string }) {
    const raw = extractRefreshTokenFromCookie(req);
    if (!raw) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const stored = await this.redis.get(`refresh:${payload.sub}`);
    if (!stored) {
      throw new UnauthorizedException('Session expired');
    }

    const incomingHash = createHash('sha256').update(raw).digest('hex');
    const a = Buffer.from(incomingHash);
    const b = Buffer.from(stored);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return { id: payload.sub };
  }
}
