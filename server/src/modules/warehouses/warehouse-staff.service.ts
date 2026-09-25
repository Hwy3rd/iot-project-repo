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
import { AssignWarehouseStaffDto } from './dto/assign-warehouse-staff.dto';
import { WarehouseStaff } from './entities/warehouse-staff.entity';
import { Warehouse } from './entities/warehouse.entity';

// Manages the (user, warehouse, role) assignments that WarehouseScopeGuard
// and AuditLogsService read to decide who may act on / see which warehouse.
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

  // Upsert: assigning someone already in the warehouse just changes their
  // role there (one row per user+warehouse — the table's composite PK).
  //
  // Staff is Staff everywhere: the Staff role in a warehouse is only for
  // users whose account role is Staff, and they get no other role. The
  // check-in requirement (AttendanceGate on the frontend) is decided by the
  // account role, so e.g. a Manager acting as Staff somewhere would never
  // be asked to check in there. Manager/Technician may still mix across
  // warehouses.
  async assign(
    warehouseId: string,
    userId: string,
    dto: AssignWarehouseStaffDto,
  ) {
    await this.assertWarehouseExists(warehouseId);
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    if ((user.role === UserRole.STAFF) !== (dto.role === UserRole.STAFF)) {
      throw new BadRequestException(
        user.role === UserRole.STAFF
          ? 'A Staff account can only be assigned as Staff'
          : 'Only Staff accounts can be assigned as Staff',
      );
    }

    const existing = await this.warehouseStaffRepository.findOne({
      where: { warehouseId, userId },
    });
    const assignment =
      existing ?? this.warehouseStaffRepository.create({ warehouseId, userId });
    assignment.role = dto.role;
    return this.warehouseStaffRepository.save(assignment);
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
