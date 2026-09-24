import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from '../../../libs/constants/user.constant';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const payload = {
    sub: 'u1',
    username: 'john',
    email: null,
    role: UserRole.STAFF,
    status: UserStatus.ACTIVE,
  };
  let redis: { exists: jest.Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    redis = { exists: jest.fn().mockResolvedValue(0) };
    strategy = new JwtStrategy(
      { get: () => 'secret' } as unknown as ConfigService,
      redis as never,
    );
  });

  it('maps a valid payload onto req.user', async () => {
    await expect(strategy.validate(payload)).resolves.toEqual({
      id: 'u1',
      username: 'john',
      email: null,
      role: UserRole.STAFF,
      status: UserStatus.ACTIVE,
    });
  });

  it('rejects a still-valid token once the account has been blocked', async () => {
    redis.exists.mockResolvedValue(1);

    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(redis.exists).toHaveBeenCalledWith('blocked:u1');
  });
});
