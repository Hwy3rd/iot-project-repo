import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import { REDIS_CLIENT } from '../../libs/redis/redis.constant';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { CreateAuditLogDto } from '../audit-logs/dto/create-audit-log.dto';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  LoginRateLimiterService,
  LoginThrottledException,
} from './login-rate-limiter.service';

jest.mock('bcryptjs');

const CONFIG: Record<string, string> = {
  JWT_REFRESH_SECRET: 'refresh-secret',
  JWT_REFRESH_EXPIRES_IN: '7d',
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findByUsername: jest.Mock;
    findOne: jest.Mock;
    touchLastLogin: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock; decode: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let auditLogsService: {
    create: jest.Mock<Promise<unknown>, [CreateAuditLogDto]>;
  };
  let loginRateLimiter: { reserve: jest.Mock; release: jest.Mock };

  const rawUser = {
    id: 'user-1',
    username: 'john',
    email: 'john@example.com',
    passwordHash: 'hashed-password',
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
  };

  const sanitizedUser = {
    id: 'user-1',
    username: 'john',
    email: 'john@example.com',
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
  };

  const nowSeconds = Math.floor(Date.now() / 1000);

  beforeEach(async () => {
    jest.clearAllMocks();

    usersService = {
      findByUsername: jest.fn(),
      findOne: jest.fn(),
      touchLastLogin: jest.fn(),
    };
    jwtService = {
      signAsync: jest
        .fn()
        .mockResolvedValueOnce('access-token')
        .mockResolvedValueOnce('refresh-token'),
      decode: jest.fn((token: string) => {
        if (token === 'access-token') return { exp: nowSeconds + 900 };
        return { exp: nowSeconds + 604800 };
      }),
    };
    auditLogsService = {
      create: jest
        .fn<Promise<unknown>, [CreateAuditLogDto]>()
        .mockResolvedValue({}),
    };
    redis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    loginRateLimiter = {
      reserve: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: (k: string) => CONFIG[k] } },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: AuditLogsService, useValue: auditLogsService },
        { provide: LoginRateLimiterService, useValue: loginRateLimiter },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('issues a token pair and touches lastLogin on success', async () => {
      usersService.findByUsername.mockResolvedValue(rawUser);
      usersService.findOne.mockResolvedValue(sanitizedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        username: 'john',
        password: 'correct-password',
      });

      expect(usersService.touchLastLogin).toHaveBeenCalledWith(rawUser.id);
      expect(redis.set).toHaveBeenCalledWith(
        `refresh:${rawUser.id}`,
        expect.any(String),
        'EX',
        expect.any(Number),
      );
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.user).toEqual(sanitizedUser);
    });

    it('audits a successful login with the request context', async () => {
      usersService.findByUsername.mockResolvedValue(rawUser);
      usersService.findOne.mockResolvedValue(sanitizedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login(
        { username: 'john', password: 'correct-password' },
        { ip: '10.0.0.1', userAgent: 'jest-ua' },
      );

      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: rawUser.id,
        action: 'auth.login',
        targetType: 'user',
        targetId: rawUser.id,
        metadata: { request: { ip: '10.0.0.1', userAgent: 'jest-ua' } },
      });
    });

    it('still logs in when the audit write fails', async () => {
      usersService.findByUsername.mockResolvedValue(rawUser);
      usersService.findOne.mockResolvedValue(sanitizedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      auditLogsService.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.login({ username: 'john', password: 'correct-password' }),
      ).resolves.toMatchObject({ accessToken: 'access-token' });
    });

    it('rejects an unknown username generically, still running a dummy compare', async () => {
      usersService.findByUsername.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ username: 'ghost', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect(redis.set).not.toHaveBeenCalled();
      const entry = auditLogsService.create.mock.calls[0][0];
      expect(entry.userId).toBeUndefined();
      expect(entry.action).toBe('auth.login_failed');
      expect(entry.metadata?.reason).toBe('unknown_username');
      expect(entry.metadata?.username).toBe('ghost');
    });

    it('rejects a wrong password with the same message as an unknown username', async () => {
      usersService.findByUsername.mockResolvedValue(rawUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ username: 'john', password: 'wrong' }),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid username or password'),
      );
      const entry = auditLogsService.create.mock.calls[0][0];
      expect(entry.userId).toBe(rawUser.id);
      expect(entry.action).toBe('auth.login_failed');
      expect(entry.metadata?.reason).toBe('wrong_password');
    });

    it('rejects a locked account only after the password is confirmed correct', async () => {
      usersService.findByUsername.mockResolvedValue({
        ...rawUser,
        status: UserStatus.LOCKED,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login({ username: 'john', password: 'correct-password' }),
      ).rejects.toThrow(ForbiddenException);

      expect(redis.set).not.toHaveBeenCalled();
      const entry = auditLogsService.create.mock.calls[0][0];
      expect(entry.action).toBe('auth.login_failed');
      expect(entry.metadata?.reason).toBe('locked');
    });

    it('refuses a throttled client before looking up the user or hashing', async () => {
      loginRateLimiter.reserve.mockRejectedValue(
        new LoginThrottledException(600),
      );

      await expect(
        service.login(
          { username: 'john', password: 'whatever' },
          { ip: '10.0.0.1' },
        ),
      ).rejects.toThrow(LoginThrottledException);

      expect(loginRateLimiter.reserve).toHaveBeenCalledWith('john', '10.0.0.1');
      expect(usersService.findByUsername).not.toHaveBeenCalled();
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(auditLogsService.create).not.toHaveBeenCalled();
    });

    it('hands the attempt back after a correct password', async () => {
      usersService.findByUsername.mockResolvedValue(rawUser);
      usersService.findOne.mockResolvedValue(sanitizedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.login(
        { username: 'john', password: 'correct-password' },
        { ip: '10.0.0.1' },
      );

      expect(loginRateLimiter.release).toHaveBeenCalledWith('john', '10.0.0.1');
    });

    it('keeps the attempt counted after a wrong password or unknown username', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      usersService.findByUsername.mockResolvedValue(rawUser);
      await expect(
        service.login({ username: 'john', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);

      usersService.findByUsername.mockResolvedValue(null);
      await expect(
        service.login({ username: 'ghost', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(loginRateLimiter.reserve).toHaveBeenCalledTimes(2);
      expect(loginRateLimiter.release).not.toHaveBeenCalled();
    });
  });

  describe('refreshTokens', () => {
    it('rotates the token pair for an active user', async () => {
      usersService.findOne.mockResolvedValue(sanitizedUser);

      const result = await service.refreshTokens(rawUser.id);

      expect(redis.set).toHaveBeenCalledWith(
        `refresh:${rawUser.id}`,
        expect.any(String),
        'EX',
        expect.any(Number),
      );
      expect(result.accessToken).toBe('access-token');
    });

    it('revokes the session and rejects if the user became locked', async () => {
      usersService.findOne.mockResolvedValue({
        ...sanitizedUser,
        status: UserStatus.LOCKED,
      });

      await expect(service.refreshTokens(rawUser.id)).rejects.toThrow(
        ForbiddenException,
      );

      expect(redis.del).toHaveBeenCalledWith(`refresh:${rawUser.id}`);
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('deletes the refresh session', async () => {
      await service.logout(rawUser.id);

      expect(redis.del).toHaveBeenCalledWith(`refresh:${rawUser.id}`);
    });
  });
});
