import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { AuditLog } from './entities/audit-log.entity';

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogsRepository: Repository<AuditLog>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Warehouse)
    private readonly warehousesRepository: Repository<Warehouse>,
  ) {}

  async create(createAuditLogDto: CreateAuditLogDto) {
    const user = await this.usersRepository.findOne({
      where: { id: createAuditLogDto.userId },
    });
    if (!user) {
      throw new NotFoundException(`User ${createAuditLogDto.userId} not found`);
    }

    if (createAuditLogDto.warehouseId) {
      const warehouse = await this.warehousesRepository.findOne({
        where: { id: createAuditLogDto.warehouseId },
      });
      if (!warehouse) {
        throw new NotFoundException(
          `Warehouse ${createAuditLogDto.warehouseId} not found`,
        );
      }
    }

    const auditLog = this.auditLogsRepository.create({
      userId: createAuditLogDto.userId,
      warehouseId: createAuditLogDto.warehouseId ?? null,
      action: createAuditLogDto.action,
      targetType: createAuditLogDto.targetType ?? null,
      targetId: createAuditLogDto.targetId ?? null,
      metadata: createAuditLogDto.metadata ?? null,
    });
    return this.auditLogsRepository.save(auditLog);
  }

  findAll(queryAuditLogDto: QueryAuditLogDto = {}) {
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
    return this.auditLogsRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string) {
    const auditLog = await this.auditLogsRepository.findOne({
      where: { id },
    });
    if (!auditLog) {
      throw new NotFoundException(`Audit log ${id} not found`);
    }
    return auditLog;
  }
}
