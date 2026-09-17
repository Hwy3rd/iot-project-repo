import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';

describe('JwtRefreshStrategy', () => {
  let redis: { get: jest.Mock };
  let strategy: JwtRefreshStrategy;

  const config = {
    get: (key: string) =>
      key === 'JWT_REFRESH_SECRET' ? 'refresh-secret' : undefined,
  } as unknown as ConfigService;

  const buildRequest = (token: string | null): Request =>
    ({ cookies: { refresh_token: token } }) as unknown as Request;

  beforeEach(() => {
    redis = { get: jest.fn() };
    strategy = new JwtRefreshStrategy(config, redis as never);
  });

  it('resolves the user id when the token hash matches the stored session', async () => {
    const rawToken = 'a-valid-refresh-token';
    const hash = createHash('sha256').update(rawToken).digest('hex');
    redis.get.mockResolvedValue(hash);

    const result = await strategy.validate(buildRequest(rawToken), {
      sub: 'user-1',
    });

    expect(result).toEqual({ id: 'user-1' });
    expect(redis.get).toHaveBeenCalledWith('refresh:user-1');
  });

  it('rejects when no session exists in Redis', async () => {
    redis.get.mockResolvedValue(null);

    await expect(
      strategy.validate(buildRequest('some-token'), { sub: 'user-1' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when the stored hash does not match the incoming token', async () => {
    redis.get.mockResolvedValue('a-different-hash');

    await expect(
      strategy.validate(buildRequest('some-token'), { sub: 'user-1' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
