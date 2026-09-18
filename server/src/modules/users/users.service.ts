import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { UploadFilesService } from '../upload-files/upload-files.service';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

const SALT_ROUNDS = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly uploadFilesService: UploadFilesService,
  ) {}

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

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    Object.assign(user, updateUserDto);
    const saved = await this.saveUser(user);
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
  }
}
