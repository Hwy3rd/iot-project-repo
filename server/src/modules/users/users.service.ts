import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import Redis from 'ioredis';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { UserRole, UserStatus } from '../../libs/constants/user.constant';
import {
  blockedUserKey,
  REDIS_CLIENT,
  refreshSessionKey,
} from '../../libs/redis/redis.constant';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { UploadFilesService } from '../upload-files/upload-files.service';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

const SALT_ROUNDS = 10;

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

  async findAll() {
    const users = await this.usersRepository.find();
    return users.map((user) => this.sanitize(user));
  }

  async findOne(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return this.sanitize(user);
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

    Object.assign(user, updateUserDto);
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

  async unlock(id: string) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    user.status = UserStatus.ACTIVE;
    const saved = await this.saveUser(user);
    await this.redis.del(blockedUserKey(id));
    return this.sanitize(saved);
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
}
