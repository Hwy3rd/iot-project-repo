import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import Redis from 'ioredis';
import { Strategy } from 'passport-jwt';
import { UserRole, UserStatus } from '../../../libs/constants/user.constant';
import {
  blockedUserKey,
  REDIS_CLIENT,
} from '../../../libs/redis/redis.constant';

function extractJwtFromCookie(req: Request): string | null {
  const cookies = req?.cookies as Record<string, string> | undefined;
  return cookies?.[process.env.COOKIE_NAME ?? 'access_token'] ?? null;
}

interface AccessTokenPayload {
  sub: string;
  username: string;
  email: string | null;
  role: UserRole;
  status: UserStatus;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super({
      jwtFromRequest: extractJwtFromCookie,
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  // Still no DB read: the one extra lookup is a Redis EXISTS on the
  // blocked-user key, so locking/deleting an account takes effect on the
  // next request instead of when the current access token expires. Role
  // changes still only apply from the next refresh.
  async validate(payload: AccessTokenPayload) {
    if (payload.status === UserStatus.LOCKED) {
      throw new UnauthorizedException('Account is locked');
    }
    if (await this.redis.exists(blockedUserKey(payload.sub))) {
      throw new UnauthorizedException('Account is locked or no longer exists');
    }

    return {
      id: payload.sub,
      username: payload.username,
      email: payload.email,
      role: payload.role,
      status: payload.status,
    };
  }
}
