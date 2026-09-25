import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import {
  dayBetween,
  narrowWarehouseIds,
  withSearch,
} from '../../common/query/find-filters';
import { QueryBatchDto } from './dto/query-batch.dto';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, QueryFailedError, Repository } from 'typeorm';
import { BatchStatus } from '../../libs/constants/batch.constant';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { ProductType } from '../product-types/entities/product-type.entity';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';
import { Batch } from './entities/batch.entity';
import {
  assertInScope,
  bulkDelete,
  BulkDeleteResult,
} from '../../common/bulk/bulk-delete';

@Injectable()
export class BatchesService {
  constructor(
    @InjectRepository(Batch)
    private readonly batchesRepository: Repository<Batch>,
    @InjectRepository(ColdRoom)
    private readonly coldRoomsRepository: Repository<ColdRoom>,
    @InjectRepository(ProductType)
    private readonly productTypesRepository: Repository<ProductType>,
  ) {}

  private assertValidDates(receivedAt: string, expiryDate: string) {
    if (new Date(expiryDate) <= new Date(receivedAt)) {
      throw new BadRequestException('expiry_date must be after received_at');
    }
  }

  // Only enforced when the product type declares a required storage range;
  // product types without one (e.g. ambient/dry goods) skip this check.
  private assertColdRoomFitsProductType(
    coldRoom: ColdRoom,
    productType: ProductType,
  ) {
    if (
      productType.storageTempMin == null ||
      productType.storageTempMax == null
    ) {
      return;
    }
    if (
      coldRoom.tempMin < productType.storageTempMin ||
      coldRoom.tempMax > productType.storageTempMax
    ) {
      throw new BadRequestException(
        `Cold room temperature range (${coldRoom.tempMin}–${coldRoom.tempMax}) does not fit ` +
          `product type's required range (${productType.storageTempMin}–${productType.storageTempMax})`,
      );
    }
  }

  private async saveBatch(batch: Batch): Promise<Batch> {
    try {
      return await this.batchesRepository.save(batch);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException(
          'A batch with this code already exists in the cold room',
        );
      }
      throw error;
    }
  }

  async create(createBatchDto: CreateBatchDto) {
    this.assertValidDates(createBatchDto.receivedAt, createBatchDto.expiryDate);

    const coldRoom = await this.coldRoomsRepository.findOne({
      where: { id: createBatchDto.coldRoomId },
    });
    if (!coldRoom) {
      throw new NotFoundException(
        `Cold room ${createBatchDto.coldRoomId} not found`,
      );
    }

    const productType = await this.productTypesRepository.findOne({
      where: { id: createBatchDto.productTypeId },
    });
    if (!productType) {
      throw new NotFoundException(
        `Product type ${createBatchDto.productTypeId} not found`,
      );
    }

    this.assertColdRoomFitsProductType(coldRoom, productType);

    const batch = this.batchesRepository.create({
      coldRoomId: createBatchDto.coldRoomId,
      productTypeId: createBatchDto.productTypeId,
      batchCode: createBatchDto.batchCode,
      quantity: createBatchDto.quantity,
      supplier: createBatchDto.supplier ?? null,
      receivedAt: createBatchDto.receivedAt,
      expiryDate: createBatchDto.expiryDate,
      notes: createBatchDto.notes ?? null,
      status: BatchStatus.IN_STOCK,
    });
    return this.saveBatch(batch);
  }

  // access omitted = unfiltered (internal callers); see WarehouseAccess.
  async findAll(
    access?: WarehouseAccess,
    query: QueryBatchDto = {},
  ): Promise<Paginated<Batch>> {
    const ids = narrowWarehouseIds(access?.warehouseIds, query.warehouseId);
    if (ids?.length === 0) return Paginated.empty(query);
    const where: FindOptionsWhere<Batch> = {};
    if (ids) where.coldRoom = { warehouseId: In(ids) };
    if (query.status) where.status = query.status;
    if (query.coldRoomId) where.coldRoomId = query.coldRoomId;
    if (query.productTypeId) where.productTypeId = query.productTypeId;
    const expiryDate = dayBetween(query.expiryFrom, query.expiryTo);
    if (expiryDate) where.expiryDate = expiryDate;
    const receivedAt = dayBetween(query.receivedFrom, query.receivedTo);
    if (receivedAt) where.receivedAt = receivedAt;
    const pagination = resolvePagination(query);
    const [items, total] = await this.batchesRepository.findAndCount({
      where: withSearch(where, query.search, ['batchCode', 'supplier']),
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  async findOne(id: string) {
    const batch = await this.batchesRepository.findOne({ where: { id } });
    if (!batch) {
      throw new NotFoundException(`Batch ${id} not found`);
    }
    return batch;
  }

  async update(id: string, updateBatchDto: UpdateBatchDto) {
    const batch = await this.batchesRepository.findOne({ where: { id } });
    if (!batch) {
      throw new NotFoundException(`Batch ${id} not found`);
    }

    this.assertValidDates(
      updateBatchDto.receivedAt ?? batch.receivedAt,
      updateBatchDto.expiryDate ?? batch.expiryDate,
    );

    Object.assign(batch, updateBatchDto);
    return this.saveBatch(batch);
  }

  // Marks stock as physically taken out of the cold room. Distinct from a
  // generic soft-delete: removed_at/status ARE this entity's "no longer
  // active" state, so there's no separate archive flag to maintain.
  async remove(id: string) {
    const batch = await this.batchesRepository.findOne({ where: { id } });
    if (!batch) {
      throw new NotFoundException(`Batch ${id} not found`);
    }
    if (batch.removedAt) {
      throw new ConflictException(`Batch ${id} was already removed`);
    }

    batch.removedAt = new Date().toISOString().slice(0, 10);
    batch.status = BatchStatus.REMOVED;
    await this.batchesRepository.save(batch);
  }

  // `access` comes from @WarehouseListScope({ requireShift: true }) with the
  // same roles as DELETE /batches/:id, so each row is judged exactly like
  // that route's @WarehouseScope would judge it.
  async bulkRemove(
    ids: string[],
    access: WarehouseAccess,
  ): Promise<BulkDeleteResult> {
    const batches = await this.batchesRepository.find({
      where: { id: In(ids) },
      relations: { coldRoom: true },
    });
    const warehouseOf = new Map(
      batches.map((b) => [b.id, b.coldRoom?.warehouseId ?? null]),
    );
    return bulkDelete(ids, (id) => {
      assertInScope(id, warehouseOf, access.warehouseIds);
      return this.remove(id);
    });
  }
}
