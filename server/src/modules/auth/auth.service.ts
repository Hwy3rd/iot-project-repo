import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import {
  REDIS_CLIENT,
  refreshSessionKey,
} from '../../libs/redis/redis.constant';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

// Precomputed bcrypt hash of an arbitrary string (bcrypt.hashSync('dummy-password-for-timing-safety', 10)).
// Compared against on a login with an unknown username so the response takes
// roughly the same time as a known-username/wrong-password login, closing a
// timing side channel that would otherwise let an attacker enumerate usernames.
const DUMMY_PASSWORD_HASH =
  '$2b$10$.YP5X8WSsgrYpppbMsqBxuff8xABLXNhvkmvU7yiECvWhliUM7VVW';

interface TokenSubject {
  id: string;
  username: string;
  email: string | null;
  role: UserRole;
  status: UserStatus;
}

// Request details recorded on auth.login / auth.login_failed entries.
export interface LoginContext {
  ip?: string | null;
  userAgent?: string | null;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async login(dto: LoginDto, context: LoginContext = {}) {
    const user = await this.usersService.findByUsername(dto.username);

    // Unknown username: no user to attribute the attempt to, so the entry
    // has a null user_id and keeps the attempted username in metadata.
    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      this.auditLogin(null, 'auth.login_failed', context, {
        reason: 'unknown_username',
        username: dto.username,
      });
      throw new UnauthorizedException('Invalid username or password');
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      this.auditLogin(user.id, 'auth.login_failed', context, {
        reason: 'wrong_password',
      });
      throw new UnauthorizedException('Invalid username or password');
    }

    if (user.status === UserStatus.LOCKED) {
      this.auditLogin(user.id, 'auth.login_failed', context, {
        reason: 'locked',
      });
      throw new ForbiddenException('Account is locked');
    }

    const tokens = await this.issueTokenPair({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
    });

    await this.usersService.touchLastLogin(user.id);
    this.auditLogin(user.id, 'auth.login', context);
    const sanitizedUser = await this.usersService.findOne(user.id);

    return { ...tokens, user: sanitizedUser };
  }

  // Fire-and-forget on purpose: awaiting the insert on any failure path
  // would add DB latency that could differ between paths and reopen the
  // enumeration timing channel the dummy bcrypt compare above exists to
  // close. A failed write is only logged.
  private auditLogin(
    userId: string | null,
    action: 'auth.login' | 'auth.login_failed',
    context: LoginContext,
    extra: Record<string, unknown> = {},
  ): void {
    this.auditLogsService
      .create({
        userId: userId ?? undefined,
        action,
        targetType: 'user',
        targetId: userId ?? undefined,
        metadata: {
          ...extra,
          request: {
            ip: context.ip ?? null,
            userAgent: context.userAgent ?? null,
          },
        },
      })
      .catch((error: unknown) =>
        this.logger.error(
          `Failed to write audit log "${action}"`,
          error instanceof Error ? error.stack : String(error),
        ),
      );
  }

  async refreshTokens(userId: string): Promise<TokenPair> {
    const user = await this.usersService.findOne(userId);

    if (user.status === UserStatus.LOCKED) {
      await this.redis.del(refreshSessionKey(userId));
      throw new ForbiddenException('Account is locked');
    }

    return this.issueTokenPair(user);
  }

  async logout(userId: string): Promise<void> {
    await this.redis.del(refreshSessionKey(userId));
  }

  private async issueTokenPair(user: TokenSubject): Promise<TokenPair> {
    const payload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
    };

    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.jwtService.signAsync({ sub: user.id }, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d',
    } as JwtSignOptions);

    const decodedAccess = this.jwtService.decode<{ exp: number }>(accessToken);
    const decodedRefresh = this.jwtService.decode<{ exp: number }>(
      refreshToken,
    );

    const refreshTtlSeconds =
      decodedRefresh.exp - Math.floor(Date.now() / 1000);
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    await this.redis.set(
      refreshSessionKey(user.id),
      tokenHash,
      'EX',
      refreshTtlSeconds,
    );

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: decodedAccess.exp * 1000,
      refreshTokenExpiresAt: decodedRefresh.exp * 1000,
    };
  }
}
