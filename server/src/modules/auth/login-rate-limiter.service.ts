import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import {
  LOGIN_ACCOUNT_SCOPES,
  LOGIN_MAX_FAILED_ENV,
  LOGIN_PROGRESSIVE_SCOPES,
  LOGIN_THROTTLE_DEFAULTS,
  LOGIN_THROTTLE_SCOPES,
  LoginThrottleScope,
} from '../../libs/constants/auth.constant';
import {
  loginBlockedKey,
  loginFailKey,
  loginStrikeKey,
  loginThrottleAccount,
  REDIS_CLIENT,
} from '../../libs/redis/redis.constant';

// Refuses the attempt (returning the longest remaining TTL among full
// buckets) or counts it in every bucket — in one script, so concurrent
// logins can't all pass the check before any of them is counted.
//
// For n buckets (in LOGIN_THROTTLE_SCOPES order):
//   KEYS[i]       failure counter          ARGV[i]       max failures
//   KEYS[n+i]     strike counter           ARGV[n+i]     fixed lockout in
//                                                        seconds, 0 = escalating
//   KEYS[2n+1]    account blocked marker   ARGV[2n+i]    '1' if the bucket
//                                                        marks the account
//   ARGV[3n+1]    window, ARGV[3n+2] strike memory, ARGV[3n+3..] lockout
//                 steps — all in seconds
//
// A bucket's first failure starts the window. The failure that fills it
// restarts its TTL as the lockout — escalating ones count a strike and use
// the strike'th step, the last one repeating — so a lockout always lasts
// its full length. A full bucket that somehow lost its TTL gets the window back, so
// it can't block forever.
const RESERVE_SCRIPT = `
local n = (#KEYS - 1) / 2
local marker = KEYS[2 * n + 1]
local window = tonumber(ARGV[3 * n + 1])
local memory = tonumber(ARGV[3 * n + 2])
local steps = #ARGV - (3 * n + 2)
local retry = 0
for i = 1, n do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then
    local ttl = redis.call('TTL', KEYS[i])
    if ttl < 0 then
      ttl = window
      redis.call('EXPIRE', KEYS[i], ttl)
    end
    if ttl > retry then retry = ttl end
  end
end
if retry > 0 then return retry end
for i = 1, n do
  local count = redis.call('INCR', KEYS[i])
  if count >= tonumber(ARGV[i]) then
    local lockout = tonumber(ARGV[n + i])
    if lockout == 0 then
      local strikes = redis.call('INCR', KEYS[n + i])
      redis.call('EXPIRE', KEYS[n + i], memory)
      lockout = tonumber(ARGV[3 * n + 2 + math.min(strikes, steps)])
    end
    redis.call('EXPIRE', KEYS[i], lockout)
    if ARGV[2 * n + i] == '1' and redis.call('TTL', marker) < lockout then
      redis.call('SET', marker, '1', 'EX', lockout)
    end
  elseif count == 1 or redis.call('TTL', KEYS[i]) == -1 then
    redis.call('EXPIRE', KEYS[i], window)
  end
end
return 0
`;

// Hands a reserved attempt back after a correct password. KEYS[1..2] (this
// client's failures and strikes on this account) are cleared outright; the
// shared buckets KEYS[3..] only get their one slot back, so a success can't
// wipe out failures other logins piled up. The existence check stops DECR
// from recreating an expired key with no TTL.
const RELEASE_SCRIPT = `
redis.call('DEL', KEYS[1], KEYS[2])
for i = 3, #KEYS do
  if tonumber(redis.call('GET', KEYS[i]) or '0') > 0 then
    redis.call('DECR', KEYS[i])
  end
end
return 0
`;

export class LoginThrottledException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    super(
      `Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${minutes} phút.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

// Per-client/per-account failed-login limits (buckets and lockout policy in
// auth.constant.ts; every number from env, see .env.example). Redis-backed
// like ChatbotRateLimiterService, so the count holds across app restarts
// and replicas. Every attempt is reserved up front and handed back on a
// correct password — so only failures stay counted, without a race between
// checking and counting. An admin can lift an account's block early
// (UsersService.unlock).
@Injectable()
export class LoginRateLimiterService {
  // ARGV for RESERVE_SCRIPT, fixed at boot.
  private readonly reserveArgs: string[];

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    const positiveInt = (name: string, fallback: number): number => {
      const raw = config.get<string>(name);
      if (raw === undefined || raw === '') return fallback;
      const value = Number(raw);
      // Fail at boot: a typo here would otherwise reach the Lua script as
      // NaN and break every login, or as 0 and refuse all of them.
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer, got "${raw}"`);
      }
      return value;
    };
    const d = LOGIN_THROTTLE_DEFAULTS;
    const stepsRaw = config.get<string>('LOGIN_LOCKOUT_STEPS_MINUTES');
    const steps =
      stepsRaw === undefined || stepsRaw.trim() === ''
        ? d.lockoutStepsMinutes
        : stepsRaw.split(',').map((step) => Number(step.trim()));
    // Same fail-at-boot reasoning; a step shorter than the one before is
    // almost certainly a typo, not a policy.
    if (
      !steps.every((step) => Number.isInteger(step) && step >= 1) ||
      steps.some((step, i) => i > 0 && step < steps[i - 1])
    ) {
      throw new Error(
        `LOGIN_LOCKOUT_STEPS_MINUTES must be a comma-separated list of non-decreasing positive integers, got "${stepsRaw}"`,
      );
    }
    const accountLockout =
      positiveInt('LOGIN_ACCOUNT_LOCKOUT_MINUTES', d.accountLockoutMinutes) *
      60;

    this.reserveArgs = [
      ...LOGIN_THROTTLE_SCOPES.map((scope) =>
        String(positiveInt(LOGIN_MAX_FAILED_ENV[scope], d.maxFailed[scope])),
      ),
      ...LOGIN_THROTTLE_SCOPES.map((scope) =>
        LOGIN_PROGRESSIVE_SCOPES.includes(scope) ? '0' : String(accountLockout),
      ),
      ...LOGIN_THROTTLE_SCOPES.map((scope) =>
        LOGIN_ACCOUNT_SCOPES.includes(scope) ? '1' : '0',
      ),
      String(positiveInt('LOGIN_FAILED_WINDOW_MINUTES', d.windowMinutes) * 60),
      String(
        positiveInt('LOGIN_LOCKOUT_RESET_HOURS', d.lockoutResetHours) * 3600,
      ),
      ...steps.map((step) => String(step * 60)),
    ];
  }

  // Throws LoginThrottledException if any bucket is full; otherwise counts
  // this attempt. Call before verifying the password.
  async reserve(username: string, ip: string | null): Promise<void> {
    const ids = this.bucketIds(username, ip);
    const keys = [
      ...LOGIN_THROTTLE_SCOPES.map((scope) => loginFailKey(scope, ids[scope])),
      ...LOGIN_THROTTLE_SCOPES.map((scope) =>
        loginStrikeKey(scope, ids[scope]),
      ),
      loginBlockedKey(ids.account),
    ];
    const retryAfter = Number(
      await this.redis.eval(
        RESERVE_SCRIPT,
        keys.length,
        ...keys,
        ...this.reserveArgs,
      ),
    );
    if (retryAfter > 0) {
      throw new LoginThrottledException(retryAfter);
    }
  }

  // The password was right: this attempt was not a guess.
  async release(username: string, ip: string | null): Promise<void> {
    const ids = this.bucketIds(username, ip);
    await this.redis.eval(
      RELEASE_SCRIPT,
      4,
      loginFailKey('account_ip', ids.account_ip),
      loginStrikeKey('account_ip', ids.account_ip),
      loginFailKey('ip', ids.ip),
      loginFailKey('account', ids.account),
    );
  }

  private bucketIds(
    username: string,
    ip: string | null,
  ): Record<LoginThrottleScope, string> {
    const account = loginThrottleAccount(username);
    const client = ip ?? 'unknown';
    return { account_ip: `${account}:${client}`, ip: client, account };
  }
}
