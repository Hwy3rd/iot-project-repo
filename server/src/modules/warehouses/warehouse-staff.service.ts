import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../../libs/constants/user.constant';
import { User } from '../users/entities/user.entity';
import { WarehouseStaff } from './entities/warehouse-staff.entity';
import { Warehouse } from './entities/warehouse.entity';

// Manages the (user, warehouse) assignments that WarehouseScopeGuard and
// AuditLogsService read to decide who may act on / see which warehouse.
// What a user may do there is their account role, not something set here.
@Injectable()
export class WarehouseStaffService {
  constructor(
    @InjectRepository(WarehouseStaff)
    private readonly warehouseStaffRepository: Repository<WarehouseStaff>,
    @InjectRepository(Warehouse)
    private readonly warehousesRepository: Repository<Warehouse>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async findAll(
    warehouseId: string,
    query: PaginationQueryDto = {},
  ): Promise<Paginated<WarehouseStaff>> {
    await this.assertWarehouseExists(warehouseId);
    const pagination = resolvePagination(query);
    const [items, total] = await this.warehouseStaffRepository.findAndCount({
      where: { warehouseId },
      relations: { user: true },
      order: { createdAt: 'ASC', userId: 'ASC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  // Idempotent: assigning someone already in the warehouse returns their
  // existing row (one per user+warehouse — the table's composite PK).
  async assign(warehouseId: string, userId: string) {
    await this.assertWarehouseExists(warehouseId);
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, username: true, fullName: true, role: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    // Admin already bypasses warehouse scope everywhere (WarehouseScopeGuard).
    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Admins see every warehouse and are not assigned to one',
      );
    }

    const existing = await this.warehouseStaffRepository.findOne({
      where: { warehouseId, userId },
    });
    const assignment =
      existing ??
      (await this.warehouseStaffRepository.save(
        this.warehouseStaffRepository.create({ warehouseId, userId }),
      ));
    // The response carries the user (and so their role), like findAll.
    assignment.user = user;
    return assignment;
  }

  async unassign(warehouseId: string, userId: string) {
    const result = await this.warehouseStaffRepository.delete({
      warehouseId,
      userId,
    });
    if (!result.affected) {
      throw new NotFoundException(
        `User ${userId} is not assigned to warehouse ${warehouseId}`,
      );
    }
  }

  private async assertWarehouseExists(warehouseId: string) {
    const exists = await this.warehousesRepository.existsBy({
      id: warehouseId,
    });
    if (!exists) {
      throw new NotFoundException(`Warehouse ${warehouseId} not found`);
    }
  }
}
