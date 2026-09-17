import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { UserRole, UserStatus } from '../../../libs/constants/user.constant';

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
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: extractJwtFromCookie,
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  validate(payload: AccessTokenPayload) {
    if (payload.status === UserStatus.LOCKED) {
      throw new UnauthorizedException('Account is locked');
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
