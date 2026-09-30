// Input caps shared by login (LoginDto) and every DTO that sets a username
// or password (CreateUserDto, ChangePasswordDto, ResetPasswordDto) — login
// must accept anything those can store, or an account could be created that
// can never log in. 64 is the floor OWASP asks sites to allow, and keeps an
// ASCII password under bcrypt's 72-byte input limit (bytes past it are
// silently ignored).
export const USERNAME_MAX_LENGTH = 50;
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 64;

// Failed-login buckets (LoginRateLimiterService), checked before any bcrypt
// work. Three because each alone has a hole:
//   - account_ip: the tight one — one client guessing one account's password.
//   - ip: one client spraying many usernames, which account_ip never sees.
//   - account: many IPs (a botnet) on one account.
// Order matters: it's the order of the Redis script's KEYS/ARGV.
export const LOGIN_THROTTLE_SCOPES = ['account_ip', 'ip', 'account'] as const;
export type LoginThrottleScope = (typeof LOGIN_THROTTLE_SCOPES)[number];

// How long a full bucket blocks logins:
//   - account_ip and ip escalate through LOGIN_LOCKOUT_STEPS_MINUTES: the
//     1st lockout uses the first step, the 2nd the second, and so on, the
//     last step repeating from then on — so a typo-prone user waits a
//     minute while a guessing script is slowed to a few tries an hour. The
//     count of lockouts ("strikes") is forgotten after
//     LOGIN_LOCKOUT_RESET_HOURS without a new one; a correct password also
//     clears the account_ip strikes (never the ip ones — an attacker could
//     reset those by logging into an account of their own).
//   - account stays fixed (LOGIN_ACCOUNT_LOCKOUT_MINUTES) and its cap high:
//     anyone can fail logins for any username from anywhere, so escalating
//     it would hand an attacker a cheap way to lock a real user — or the
//     admin — out for an hour at a time.
export const LOGIN_PROGRESSIVE_SCOPES: readonly LoginThrottleScope[] = [
  'account_ip',
  'ip',
];

// Buckets tied to one username: filling one marks the account as blocked
// (loginBlockedKey), which is what the Users page shows and what an admin's
// unlock clears. The ip bucket spans every username, so it isn't one of them.
export const LOGIN_ACCOUNT_SCOPES: readonly LoginThrottleScope[] = [
  'account_ip',
  'account',
];

export const LOGIN_MAX_FAILED_ENV: Record<LoginThrottleScope, string> = {
  account_ip: 'LOGIN_MAX_FAILED_PER_ACCOUNT_IP',
  ip: 'LOGIN_MAX_FAILED_PER_IP',
  account: 'LOGIN_MAX_FAILED_PER_ACCOUNT',
};

// Every value is overridable from env (see .env.example).
export const LOGIN_THROTTLE_DEFAULTS = {
  maxFailed: { account_ip: 5, ip: 30, account: 50 } as Record<
    LoginThrottleScope,
    number
  >,
  // LOGIN_FAILED_WINDOW_MINUTES: failures older than this (counted from a
  // bucket's first failure) are forgotten.
  windowMinutes: 15,
  // Escalating lockout: 1, 5, 15, 60, 60... minutes.
  lockoutStepsMinutes: [1, 5, 15, 60],
  lockoutResetHours: 24,
  accountLockoutMinutes: 15,
};
