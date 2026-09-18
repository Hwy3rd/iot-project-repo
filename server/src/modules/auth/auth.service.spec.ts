import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import { REDIS_CLIENT } from '../../libs/redis/redis.constant';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

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
    redis = { get: jest.fn(), set: jest.fn(), del: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: (k: string) => CONFIG[k] } },
        { provide: REDIS_CLIENT, useValue: redis },
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

    it('rejects an unknown username generically, still running a dummy compare', async () => {
      usersService.findByUsername.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ username: 'ghost', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('rejects a wrong password with the same message as an unknown username', async () => {
      usersService.findByUsername.mockResolvedValue(rawUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ username: 'john', password: 'wrong' }),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid username or password'),
      );
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
