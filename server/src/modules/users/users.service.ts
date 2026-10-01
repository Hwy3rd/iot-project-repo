import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { withSearch } from '../../common/query/find-filters';
import { QueryUserDto } from './dto/query-user.dto';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import Redis from 'ioredis';
import {
  DataSource,
  FindOptionsWhere,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import {
  blockedUserKey,
  loginBlockedKey,
  loginFailKey,
  loginStrikeKey,
  loginThrottleAccount,
  REDIS_CLIENT,
  refreshSessionKey,
} from '../../libs/redis/redis.constant';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { UploadFilesService } from '../upload-files/upload-files.service';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { bulkDelete, BulkDeleteResult } from '../../common/bulk/bulk-delete';

const SALT_ROUNDS = 10;

// Escapes Redis glob metacharacters so a username can sit inside a SCAN
// MATCH pattern literally.
const escapeGlob = (value: string) => value.replace(/[*?[\]\\]/g, '\\$&');

// Who is calling update() — needed because the same PATCH /users/:id route
// serves both Admin (any user, any field) and a user editing themselves.
export interface UserActor {
  id: string;
  role: UserRole;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly uploadFilesService: UploadFilesService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  // Cuts off every form of access the user still holds: the refresh
  // session, their current access token (via the blocked-user key checked
  // by JwtStrategy) and any open realtime sockets.
  private async revokeAccess(userId: string): Promise<void> {
    await this.redis
      .multi()
      .set(blockedUserKey(userId), '1')
      .del(refreshSessionKey(userId))
      .exec();
    await this.realtimeGateway.disconnectUser(userId);
  }

  private sanitize(user: User) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...rest } = user;
    return rest;
  }

  // Adds `loginBlockedUntil`: when the temporary block from too many failed
  // logins (LoginRateLimiterService) ends, or null if there is none. It may
  // cover only the IPs the failures came from — the Users page shows it so
  // an admin can lift it (unlock) instead of the user waiting it out. One
  // pipelined round trip for the whole page.
  private async withLoginBlock<T extends Pick<User, 'username'>>(
    users: T[],
  ): Promise<(T & { loginBlockedUntil: Date | null })[]> {
    if (users.length === 0) return [];
    const pipeline = this.redis.pipeline();
    for (const user of users) {
      pipeline.pttl(loginBlockedKey(loginThrottleAccount(user.username)));
    }
    const results = (await pipeline.exec()) ?? [];
    const now = Date.now();
    return users.map((user, i) => {
      const ttl = Number(results[i]?.[1] ?? -2);
      return {
        ...user,
        loginBlockedUntil: ttl > 0 ? new Date(now + ttl) : null,
      };
    });
  }

  // Lifts every failed-login block tied to this username: the account-wide
  // bucket and its per-IP buckets (with their escalation strikes, so the
  // next lockout starts short again). The per-IP bucket that spans all
  // usernames is left alone — it isn't this account's.
  private async clearLoginBlock(username: string): Promise<void> {
    const account = loginThrottleAccount(username);
    const keys = [
      loginBlockedKey(account),
      loginFailKey('account', account),
      loginStrikeKey('account', account),
    ];
    for (const pattern of [
      loginFailKey('account_ip', `${escapeGlob(account)}:*`),
      loginStrikeKey('account_ip', `${escapeGlob(account)}:*`),
    ]) {
      for await (const batch of this.redis.scanStream({
        match: pattern,
        count: 100,
      }) as AsyncIterable<string[]>) {
        keys.push(...batch);
      }
    }
    await this.redis.del(...keys);
  }

  private async saveUser(user: User): Promise<User> {
    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException('Username or email already in use');
      }
      throw error;
    }
  }

  async create(createUserDto: CreateUserDto) {
    const existing = await this.usersRepository.findOne({
      where: createUserDto.email
        ? [{ username: createUserDto.username }, { email: createUserDto.email }]
        : { username: createUserDto.username },
    });
    if (existing) {
      throw new ConflictException('Username or email already in use');
    }

    const passwordHash = await bcrypt.hash(createUserDto.password, SALT_ROUNDS);
    const user = this.usersRepository.create({
      username: createUserDto.username,
      email: createUserDto.email ?? null,
      phone: createUserDto.phone ?? null,
      fullName: createUserDto.fullName ?? null,
      role: createUserDto.role,
      imageUrls: createUserDto.imageUrls ?? null,
      passwordHash,
    });

    const saved = await this.saveUser(user);
    return this.sanitize(saved);
  }

  async findAll(query: QueryUserDto = {}) {
    const where: FindOptionsWhere<User> = {};
    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    const pagination = resolvePagination(query);
    const [users, total] = await this.usersRepository.findAndCount({
      where: withSearch(where, query.search, [
        'username',
        'fullName',
        'email',
        'phone',
      ]),
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    const items = await this.withLoginBlock(
      users.map((user) => this.sanitize(user)),
    );
    return Paginated.of(items, total, pagination);
  }

  async findOne(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    const [withBlock] = await this.withLoginBlock([this.sanitize(user)]);
    return withBlock;
  }

  async findByUsername(username: string) {
    return this.usersRepository.findOne({ where: { username } });
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.usersRepository.update(id, { lastLoginAt: new Date() });
  }

  async update(id: string, updateUserDto: UpdateUserDto, actor?: UserActor) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    // SelfScopeGuard lets any user PATCH their own record, and UpdateUserDto
    // carries `role` — without this check a Staff could promote themselves
    // to Admin (effective at their next token refresh). Resending the
    // current role unchanged is harmless and allowed.
    if (
      actor &&
      actor.role !== UserRole.ADMIN &&
      updateUserDto.role !== undefined &&
      updateUserDto.role !== user.role
    ) {
      throw new ForbiddenException('Only an admin can change a user role');
    }

    // Admins see every warehouse and aren't assigned to any, so a promotion
    // drops the old assignments (and with them the per-warehouse alert
    // notifications that follow them — NotificationsService.notifyNewAlert).
    if (updateUserDto.role === UserRole.ADMIN && user.role !== UserRole.ADMIN) {
      await this.dataSource.manager.delete(WarehouseStaff, { userId: id });
    }

    Object.assign(user, updateUserDto);
    const saved = await this.saveUser(user);
    return this.sanitize(saved);
  }

  // Admin sets a new password for someone else (e.g. they forgot theirs).
  // Their session ends — refresh token and open sockets — so the next
  // refresh sends them to the login page; an access token already issued
  // keeps working until it expires (JWT_EXPIRES_IN, 15 min by default).
  // Not for your own account: use changePassword(), which checks the
  // current one.
  async resetPassword(id: string, newPassword: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException(
        'Use POST /users/me/password to change your own password',
      );
    }
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const saved = await this.saveUser(user);
    await this.redis.del(refreshSessionKey(id));
    await this.realtimeGateway.disconnectUser(id);
    return this.sanitize(saved);
  }

  // The caller changes their own password. The current session stays (the
  // single-session model means there's no other one to end).
  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    // 400, not 401: a 401 would make the frontend try to refresh the session.
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      throw new BadRequestException(
        'New password must differ from the current one',
      );
    }
    user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const saved = await this.saveUser(user);
    return this.sanitize(saved);
  }

  // Takes effect immediately — see revokeAccess().
  async lock(id: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('You cannot lock your own account');
    }
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    user.status = UserStatus.LOCKED;
    const saved = await this.saveUser(user);
    await this.revokeAccess(id);
    return this.sanitize(saved);
  }

  // Lifts both kinds of block at once, so an admin has one button whatever
  // the cause: a lock set by an admin (status) and a temporary block from
  // too many failed logins.
  async unlock(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    user.status = UserStatus.ACTIVE;
    const saved = await this.saveUser(user);
    await this.redis.del(blockedUserKey(id));
    await this.clearLoginBlock(saved.username);
    const [withBlock] = await this.withLoginBlock([this.sanitize(saved)]);
    return withBlock;
  }

  async addImages(id: string, files: Express.Multer.File[]) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    const uploaded = await this.uploadFilesService.uploadImages(files, 'users');
    user.imageUrls = [...(user.imageUrls ?? []), ...uploaded];
    const saved = await this.saveUser(user);
    return this.sanitize(saved);
  }

  async removeImage(id: string, url: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    user.imageUrls = (user.imageUrls ?? []).filter((img) => img !== url);
    await this.uploadFilesService.deleteImage(url);
    const saved = await this.saveUser(user);
    return this.sanitize(saved);
  }

  // Soft delete doesn't fire ON DELETE CASCADE (that only triggers on a real
  // SQL DELETE), so stale warehouse_staff rows have to be cleaned up here.
  async remove(id: string) {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.softDelete(User, id);
      if (!result.affected) {
        throw new NotFoundException(`User ${id} not found`);
      }
      await manager.delete(WarehouseStaff, { userId: id });
    });
    await this.revokeAccess(id);
  }

  // Unlike the single DELETE (whose UI never offers it), a bulk selection
  // could include the caller — refuse that row rather than let an Admin
  // lock themselves out mid-batch.
  bulkRemove(ids: string[], callerId: string): Promise<BulkDeleteResult> {
    return bulkDelete(ids, (id) => {
      if (id === callerId) {
        throw new BadRequestException('You cannot delete your own account');
      }
      return this.remove(id);
    });
  }
}
