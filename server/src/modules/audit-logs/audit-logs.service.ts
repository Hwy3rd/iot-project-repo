import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseStaff } from '../warehouses/entities/warehouse-staff.entity';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditLogViewer {
  id: string;
  role: UserRole;
}

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogsRepository: Repository<AuditLog>,
    @InjectRepository(WarehouseStaff)
    private readonly warehouseStaffRepository: Repository<WarehouseStaff>,
  ) {}

  // Internal-only (there is no HTTP write route): called by AuditInterceptor
  // and by services that log directly (e.g. AuthService for logins). No
  // existence pre-checks on userId/warehouseId — the FKs already guarantee
  // integrity, and a lookup would wrongly reject entries about a warehouse
  // that was just soft-deleted (its row, and so the FK target, still exists).
  create(createAuditLogDto: CreateAuditLogDto) {
    const auditLog = this.auditLogsRepository.create({
      userId: createAuditLogDto.userId ?? null,
      warehouseId: createAuditLogDto.warehouseId ?? null,
      action: createAuditLogDto.action,
      targetType: createAuditLogDto.targetType ?? null,
      targetId: createAuditLogDto.targetId ?? null,
      metadata: createAuditLogDto.metadata ?? null,
    });
    return this.auditLogsRepository.save(auditLog);
  }

  // Admin sees everything. A Manager only sees entries scoped to warehouses
  // where they hold the Manager role *in that warehouse* (warehouse_staff.role,
  // not just their global account role) — entries with no warehouse_id
  // (account/master-data actions) stay Admin-only.
  async findAll(
    queryAuditLogDto: QueryAuditLogDto = {},
    viewer?: AuditLogViewer,
  ) {
    const where: FindOptionsWhere<AuditLog> = {};
    if (queryAuditLogDto.userId) {
      where.userId = queryAuditLogDto.userId;
    }
    if (queryAuditLogDto.warehouseId) {
      where.warehouseId = queryAuditLogDto.warehouseId;
    }
    if (queryAuditLogDto.targetType) {
      where.targetType = queryAuditLogDto.targetType;
    }
    if (queryAuditLogDto.targetId) {
      where.targetId = queryAuditLogDto.targetId;
    }

    const managedIds = await this.managedWarehouseIds(viewer);
    if (managedIds) {
      if (queryAuditLogDto.warehouseId) {
        if (!managedIds.includes(queryAuditLogDto.warehouseId)) {
          throw new ForbiddenException('Not a manager of this warehouse');
        }
      } else {
        if (managedIds.length === 0) return [];
        where.warehouseId = In(managedIds);
      }
    }

    return this.auditLogsRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, viewer?: AuditLogViewer) {
    const auditLog = await this.auditLogsRepository.findOne({
      where: { id },
    });
    if (!auditLog) {
      throw new NotFoundException(`Audit log ${id} not found`);
    }

    const managedIds = await this.managedWarehouseIds(viewer);
    if (
      managedIds &&
      (!auditLog.warehouseId || !managedIds.includes(auditLog.warehouseId))
    ) {
      throw new ForbiddenException('Not a manager of this warehouse');
    }
    return auditLog;
  }

  // null = unrestricted (Admin, or an internal call with no viewer).
  private async managedWarehouseIds(
    viewer?: AuditLogViewer,
  ): Promise<string[] | null> {
    if (!viewer || viewer.role === UserRole.ADMIN) return null;
    const assignments = await this.warehouseStaffRepository.find({
      where: { userId: viewer.id, role: UserRole.MANAGER },
    });
    return assignments.map((assignment) => assignment.warehouseId);
  }
}
