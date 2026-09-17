import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  const authService = {
    login: jest.fn(),
    refreshTokens: jest.fn(),
    logout: jest.fn(),
  };
  const usersService = { findOne: jest.fn() };
  const config = { get: jest.fn(() => undefined) };

  const buildRes = (): jest.Mocked<
    Pick<Response, 'cookie' | 'clearCookie'>
  > => ({
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('login sets both cookies and returns the sanitized user', async () => {
    const user = { id: 'user-1', username: 'john' };
    authService.login.mockResolvedValue({
      user,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: Date.now() + 900_000,
      refreshTokenExpiresAt: Date.now() + 604_800_000,
    });
    const res = buildRes();

    const result = await controller.login(
      { username: 'john', password: 'x' },
      res as unknown as Response,
    );

    expect(result).toBe(user);
    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.cookie).toHaveBeenNthCalledWith(
      1,
      'access_token',
      'access-token',
      expect.objectContaining({ path: '/', httpOnly: true }),
    );
    expect(res.cookie).toHaveBeenNthCalledWith(
      2,
      'refresh_token',
      'refresh-token',
      expect.objectContaining({ path: '/auth', httpOnly: true }),
    );
  });

  it('refresh rotates both cookies', async () => {
    authService.refreshTokens.mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      accessTokenExpiresAt: Date.now() + 900_000,
      refreshTokenExpiresAt: Date.now() + 604_800_000,
    });
    const res = buildRes();

    const result = await controller.refresh(
      'user-1',
      res as unknown as Response,
    );

    expect(result).toBeNull();
    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(authService.refreshTokens).toHaveBeenCalledWith('user-1');
  });

  it('logout clears cookies with the same options used to set them', async () => {
    const res = buildRes();

    await controller.logout('user-1', res as unknown as Response);

    expect(authService.logout).toHaveBeenCalledWith('user-1');
    expect(res.clearCookie).toHaveBeenNthCalledWith(
      1,
      'access_token',
      expect.objectContaining({ path: '/', httpOnly: true }),
    );
    expect(res.clearCookie).toHaveBeenNthCalledWith(
      2,
      'refresh_token',
      expect.objectContaining({ path: '/auth', httpOnly: true }),
    );
  });

  it('me delegates to usersService.findOne', async () => {
    usersService.findOne.mockResolvedValue({ id: 'user-1' });

    await controller.me('user-1');

    expect(usersService.findOne).toHaveBeenCalledWith('user-1');
  });
});
