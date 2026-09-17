# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This repo currently contains a single active project: a NestJS backend in `server/`. All application code, dependencies, and tooling live under `server/` — there is no root-level `package.json`. Run all `pnpm`/`nest` commands from inside `server/`, not the repo root.

`docker-compose.yml` and `docker-compose.production.yml` live at the repo root and orchestrate `server/` alongside its datastores.

## Commands (run from `server/`)

```bash
pnpm install              # install dependencies

pnpm run start            # start once
pnpm run start:dev        # start in watch mode (used for local dev)
pnpm run build            # nest build -> dist/

pnpm run lint             # eslint --fix on src/apps/libs/test
pnpm run format           # prettier --write on src/test

pnpm run test             # unit tests (jest, rootDir: src, matches *.spec.ts)
pnpm run test:watch
pnpm run test:cov
pnpm run test:e2e         # e2e tests (jest --config ./test/jest-e2e.json, matches *.e2e-spec.ts)

# run a single unit test file
pnpm exec jest path/to/file.spec.ts
# run a single test by name
pnpm exec jest -t "test name"
```

## Architecture

### Module structure

Feature code lives under `server/src/modules/<name>/`, following standard Nest resource scaffolding (`nest g resource`): `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`, `entities/`. Existing modules: `auth`, `users`, `redis`.

`modules/redis/redis.module.ts` is `@Global()` and exports a single `ioredis` client under the DI token `REDIS_CLIENT` (`modules/redis/redis.constant.ts`). Any provider can `@Inject(REDIS_CLIENT) private readonly redis: Redis` directly without importing `RedisModule` again — it's wired once in `app.module.ts`. This is separate from the Redis connection `BullModule.forRoot()` opens for BullMQ; the two are intentionally not shared.

Cross-cutting building blocks live under `server/src/common/`, not inside individual modules:
- `common/guards/` — `JwtAuthGuard` (`AuthGuard('jwt')`), `JwtRefreshGuard` (`AuthGuard('jwt-refresh')`), `RolesGuard`
- `common/decorators/` — `@Roles(...)`, `@GetUserId()`, `@Serialize(dto)`
- `common/interceptors/transform.interceptor.ts` — wraps every response as `{ success, statusCode, message, data }`, applies `@Serialize`'s DTO via `class-transformer`, and reads a response message set via the `RESPONSE_MESSAGE` metadata key
- `common/fitlers/global-exception.filter.ts` — global `@Catch()` filter, normalizes all thrown errors to `{ success: false, statusCode, path, timestamp, message, errors? }` (note the `fitlers` typo in the directory name — intentional/existing, don't "fix" it without also updating imports)

Shared constants/enums live under `server/src/libs/constants/` (e.g. `metadata.constant.ts` for reflector metadata keys, `user.constant.ts` for `UserRole`) rather than colocated with the guards/decorators that consume them. Import them with relative paths (`../../libs/constants/...`), not `'src/libs/constants/...'` — the latter only resolves under `nest build` (via tsconfig `baseUrl`) and silently breaks Jest, which doesn't apply that resolution.

### API response convention — every controller must follow this

`TransformInterceptor` is registered globally as `APP_INTERCEPTOR` in `app.module.ts`, so **every** controller response (success case) is automatically wrapped as `{ success, statusCode, message, data }` — controllers/services just return plain data, they never build this envelope themselves.

To control the shape of `data` (and to strip fields that must never reach the client, e.g. `passwordHash`):
1. Create a response DTO with `class-transformer`'s `@Expose()` on exactly the fields that should be visible (see `modules/users/dto/user-response.dto.ts` for the pattern). Anything not marked `@Expose()` is silently dropped, because the interceptor calls `plainToInstance(dto, data, { excludeExtraneousValues: true })`.
2. Put `@Serialize(YourResponseDto)` on the controller method. Without it, `data` passes through unshaped (whatever the service returned, as-is — including any sensitive fields).

Consequences to watch for when adding routes:
- **Never combine `@HttpCode(HttpStatus.NO_CONTENT)` with a route under this interceptor.** The interceptor always writes a JSON body, which is invalid for a 204 response. The convention here is that mutating endpoints (e.g. `DELETE`) return the default 200 with `data: null` instead of 204 — see `UsersController.remove`.
- `GlobalExceptionFilter` (the error-side counterpart of this convention) is **not** currently wired anywhere (no `APP_FILTER` provider registered) — thrown exceptions still produce Nest's default `{ statusCode, message, error }` shape, not the `{ success: false, ... }` shape the filter defines. Success and error responses are therefore inconsistent until someone registers it the same way (`{ provide: APP_FILTER, useClass: GlobalExceptionFilter }`).
- `UsersService` still manually strips `passwordHash` before returning, in addition to `UserResponseDto` not exposing it. This is intentional defense-in-depth (the service is safe to reuse from a future non-HTTP caller — a queue processor, another module — that wouldn't go through `@Serialize`), not redundant code to delete.

### Auth

JWT is delivered via **httpOnly cookies**, not an `Authorization` header. `cookie-parser` is wired in `main.ts`. Two independent tokens exist, each with its own secret/cookie/strategy — never reuse one for the other:
- **Access token** — cookie name from `COOKIE_NAME` (default `access_token`), signed with `JWT_SECRET`/`JWT_EXPIRES_IN` (default 15m). Verified by `JwtStrategy` (`modules/auth/strategies/jwt.strategy.ts`, passport strategy name `'jwt'`) + `JwtAuthGuard`. The payload embeds `{ sub, username, email, role, status }` directly — `JwtStrategy.validate()` does **not** hit the DB, by design: role/status changes only take effect once the current access token expires. `validate()` returns `{ id, username, email, role, status }` onto `req.user`; `GetUserId()` reads `.id`, `RolesGuard` reads `.role`.
- **Refresh token** — cookie name from `REFRESH_COOKIE_NAME` (default `refresh_token`), scoped to path `/auth` only, signed with `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRES_IN` (default 7d) via the same injected `JwtService` using its per-call `secret`/`expiresIn` override (no second `JwtModule` registration). Verified by `JwtRefreshStrategy` (`modules/auth/strategies/jwt-refresh.strategy.ts`, strategy name `'jwt-refresh'`) + `JwtRefreshGuard`.

**Session model: single session per user, in Redis.** `AuthService` stores `sha256(refreshToken)` (never the raw token) under key `refresh:<userId>` with TTL = the token's own remaining lifetime (derived from the signed JWT's `exp` claim via `jwtService.decode()`, not by re-parsing `'7d'`-style strings). A new login or a refresh **overwrites** that key, which is what makes it single-session — logging in again elsewhere silently invalidates any other active session. `JwtRefreshStrategy.validate()` re-hashes the incoming cookie and compares it (via `timingSafeEqual`) against the stored hash; mismatch or missing key → `UnauthorizedException`. `POST /auth/refresh` always rotates (issues a brand-new pair, overwrites Redis) and re-reads the user from the DB to refresh the embedded role/status — that DB read is intentional and does not contradict the "no DB lookup" rule above, since refresh only happens roughly once per access-token lifetime, not on every request. `POST /auth/logout` deletes the Redis key and is guarded by `JwtRefreshGuard` (not `JwtAuthGuard`) since it must still work once the short-lived access token has already expired.

`AuthService.login()` compares against a hardcoded dummy bcrypt hash when the username doesn't exist, so an unknown-username response takes the same time as a wrong-password response — don't remove this or make the two error paths return different messages, it exists specifically to prevent username enumeration via timing/response content.

Cookie `path`/`httpOnly`/`secure`/`sameSite` options are centralized in `AuthController`'s private `baseCookieOptions()`/`setAuthCookies()`/`clearAuthCookies()` — always go through these when touching cookie logic, since `res.clearCookie()` silently no-ops if its options don't exactly match what `res.cookie()` set. `secure` is gated on `NODE_ENV === 'production'` (`.env` sets `NODE_ENV=development` locally) — cookies won't set at all over plain `http://` in prod-mode, and won't be marked secure in local dev.

### Persistence — three datastores are wired into `AppModule` simultaneously

`server/src/app.module.ts` registers all three at once:
- **MongoDB** via `MongooseModule.forRoot(MONGO_URI)`
- **MySQL** via `TypeOrmModule.forRoot({ type: 'mysql', ... })` (`synchronize: true` — dev-only setting, do not carry into a real production config)
- **Redis** via `BullModule.forRoot({ connection: { host, port } })`, for BullMQ queues/workers

A **Postgres** container (`db` in docker-compose) also exists but is not wired into `AppModule` — it's provisioned but currently unused by the app. When adding persistence to a module, check which store this app is actually meant to use before picking one; nothing in the code currently indicates whether Mongo or MySQL is the intended primary store per-domain.

All connection settings are read from `process.env` with local-dev fallbacks hardcoded inline in `app.module.ts`/`auth.module.ts` — there's no central config schema/validation. `ConfigModule.forRoot({ isGlobal: true })` loads `server/.env` (gitignored).

### Docker / docker-compose

Services in `docker-compose.yml`: `app`, `worker` (same image as `app`, meant for BullMQ processing, currently just runs `node dist/main.js` — there's no separate worker entrypoint file yet, so it runs the full Nest app rather than a dedicated queue processor), `db` (Postgres, unused by app), `redis`, `mysql`, `mongo`.

**Known gap:** `app`/`worker` use `build: .` with the compose file's own directory (repo root) as context, but the actual `Dockerfile` lives at `server/Dockerfile`. As currently written, `docker compose up --build` will fail to find the Dockerfile. Fix the build `context`/`dockerfile` paths (or move the compose file) before relying on this for a real build.

`server/.env` currently uses docker-network service names (`mongo`, `mysql`, `redis`, `db`) as hosts, meaning it's set up for the app to run **as a container inside the compose network**, not via `pnpm start:dev` on the host. If running the Nest app directly on the host while only the datastores run in Docker, switch those hosts back to `localhost` (the datastore ports are all published to the host).
