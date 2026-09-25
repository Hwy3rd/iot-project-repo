import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { createdBetween, withSearch } from '../../common/query/find-filters';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  And,
  DataSource,
  Equal,
  FindOptionsWhere,
  In,
  IsNull,
  Not,
  Or,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { UploadFilesService } from '../upload-files/upload-files.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { QueryWarehouseDto } from './dto/query-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { Warehouse } from './entities/warehouse.entity';
import { WarehouseStaff } from './entities/warehouse-staff.entity';
import { bulkDelete, BulkDeleteResult } from '../../common/bulk/bulk-delete';

@Injectable()
export class WarehousesService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehousesRepository: Repository<Warehouse>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly uploadFilesService: UploadFilesService,
  ) {}

  private async saveWarehouse(warehouse: Warehouse): Promise<Warehouse> {
    try {
      return await this.warehousesRepository.save(warehouse);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException('Warehouse name or code already in use');
      }
      throw error;
    }
  }

  create(createWarehouseDto: CreateWarehouseDto) {
    const warehouse = this.warehousesRepository.create({
      name: createWarehouseDto.name,
      code: createWarehouseDto.code,
      address: createWarehouseDto.address ?? null,
      imageUrls: createWarehouseDto.imageUrls ?? null,
    });
    return this.saveWarehouse(warehouse);
  }

  // access omitted = unfiltered (internal callers); see WarehouseAccess.
  async findAll(
    access?: WarehouseAccess,
    query: QueryWarehouseDto = {},
  ): Promise<Paginated<Warehouse>> {
    const ids = access?.warehouseIds;
    if (ids?.length === 0) return Paginated.empty(query);
    const pagination = resolvePagination(query);
    const [items, total] = await this.warehousesRepository.findAndCount({
      where: buildWarehouseWhere(query, ids),
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  async findOne(id: string) {
    const warehouse = await this.warehousesRepository.findOne({
      where: { id },
    });
    if (!warehouse) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    return warehouse;
  }

  async update(id: string, updateWarehouseDto: UpdateWarehouseDto) {
    const warehouse = await this.warehousesRepository.findOne({
      where: { id },
    });
    if (!warehouse) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    Object.assign(warehouse, updateWarehouseDto);
    return this.saveWarehouse(warehouse);
  }

  async addImages(id: string, files: Express.Multer.File[]) {
    const warehouse = await this.warehousesRepository.findOne({
      where: { id },
    });
    if (!warehouse) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    const uploaded = await this.uploadFilesService.uploadImages(
      files,
      'warehouses',
    );
    warehouse.imageUrls = [...(warehouse.imageUrls ?? []), ...uploaded];
    return this.saveWarehouse(warehouse);
  }

  async removeImage(id: string, url: string) {
    const warehouse = await this.warehousesRepository.findOne({
      where: { id },
    });
    if (!warehouse) {
      throw new NotFoundException(`Warehouse ${id} not found`);
    }
    warehouse.imageUrls = (warehouse.imageUrls ?? []).filter(
      (img) => img !== url,
    );
    await this.uploadFilesService.deleteImage(url);
    return this.saveWarehouse(warehouse);
  }

  // Soft-deleting a warehouse doesn't fire ON DELETE CASCADE (that only
  // triggers on a real SQL DELETE), so child rows have to be cleaned up here.
  async remove(id: string) {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.softDelete(Warehouse, id);
      if (!result.affected) {
        throw new NotFoundException(`Warehouse ${id} not found`);
      }
      await manager.softDelete(ColdRoom, { warehouseId: id });
      await manager.delete(WarehouseStaff, { warehouseId: id });
    });
  }

  // POST /warehouses/bulk-delete — each id through remove(), see
  // common/bulk/bulk-delete.ts.
  bulkRemove(ids: string[]): Promise<BulkDeleteResult> {
    return bulkDelete(ids, (id) => this.remove(id));
  }
}

export const buildWarehouseWhere = (
  query: QueryWarehouseDto,
  ids?: string[] | null,
) => {
  const base: FindOptionsWhere<Warehouse> = {};
  if (ids) base.id = In(ids);
  const createdAt = createdBetween(query.createdFrom, query.createdTo);
  if (createdAt) base.createdAt = createdAt;
  if (query.hasAddress === 'true') {
    base.address = And(Not(IsNull()), Not(Equal('')));
  } else if (query.hasAddress === 'false') {
    base.address = Or(IsNull(), Equal(''));
  }
  return withSearch(base, query.search, ['name', 'code', 'address']);
};
