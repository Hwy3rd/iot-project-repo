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
  createdBetween,
  narrowWarehouseIds,
  withSearch,
} from '../../common/query/find-filters';
import { QueryColdRoomDto } from './dto/query-cold-room.dto';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, QueryFailedError, Repository } from 'typeorm';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { CreateColdRoomDto } from './dto/create-cold-room.dto';
import { UpdateColdRoomDto } from './dto/update-cold-room.dto';
import { ColdRoom } from './entities/cold-room.entity';
import { bulkDelete, BulkDeleteResult } from '../../common/bulk/bulk-delete';

@Injectable()
export class ColdRoomsService {
  constructor(
    @InjectRepository(ColdRoom)
    private readonly coldRoomsRepository: Repository<ColdRoom>,
    @InjectRepository(Warehouse)
    private readonly warehousesRepository: Repository<Warehouse>,
  ) {}

  private assertValidRange(tempMin: number, tempMax: number) {
    if (tempMin >= tempMax) {
      throw new BadRequestException('temp_min must be less than temp_max');
    }
  }

  private async saveColdRoom(coldRoom: ColdRoom): Promise<ColdRoom> {
    try {
      return await this.coldRoomsRepository.save(coldRoom);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException(
          'A cold room with this name already exists in the warehouse',
        );
      }
      throw error;
    }
  }

  async create(createColdRoomDto: CreateColdRoomDto) {
    this.assertValidRange(createColdRoomDto.tempMin, createColdRoomDto.tempMax);

    const warehouse = await this.warehousesRepository.findOne({
      where: { id: createColdRoomDto.warehouseId },
    });
    if (!warehouse) {
      throw new NotFoundException(
        `Warehouse ${createColdRoomDto.warehouseId} not found`,
      );
    }

    const coldRoom = this.coldRoomsRepository.create({
      warehouseId: createColdRoomDto.warehouseId,
      name: createColdRoomDto.name,
      tempMin: createColdRoomDto.tempMin,
      tempMax: createColdRoomDto.tempMax,
      ...(createColdRoomDto.hysteresis !== undefined && {
        hysteresis: createColdRoomDto.hysteresis,
      }),
      ...(createColdRoomDto.doorOpenMaxSeconds !== undefined && {
        doorOpenMaxSeconds: createColdRoomDto.doorOpenMaxSeconds,
      }),
      capacityPallets: createColdRoomDto.capacityPallets ?? null,
      capacityWeightKg: createColdRoomDto.capacityWeightKg ?? null,
      capacityVolumeM3: createColdRoomDto.capacityVolumeM3 ?? null,
    });
    return this.saveColdRoom(coldRoom);
  }

  // access omitted = unfiltered (internal callers); see WarehouseAccess.
  async findAll(
    access?: WarehouseAccess,
    query: QueryColdRoomDto = {},
  ): Promise<Paginated<ColdRoom>> {
    const ids = narrowWarehouseIds(access?.warehouseIds, query.warehouseId);
    if (ids?.length === 0) return Paginated.empty(query);
    const where: FindOptionsWhere<ColdRoom> = {};
    if (ids) where.warehouseId = In(ids);
    const createdAt = createdBetween(query.createdFrom, query.createdTo);
    if (createdAt) where.createdAt = createdAt;
    const pagination = resolvePagination(query);
    const [items, total] = await this.coldRoomsRepository.findAndCount({
      where: withSearch(where, query.search, ['name']),
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  async findOne(id: string) {
    const coldRoom = await this.coldRoomsRepository.findOne({
      where: { id },
    });
    if (!coldRoom) {
      throw new NotFoundException(`Cold room ${id} not found`);
    }
    return coldRoom;
  }

  async update(id: string, updateColdRoomDto: UpdateColdRoomDto) {
    const coldRoom = await this.coldRoomsRepository.findOne({
      where: { id },
    });
    if (!coldRoom) {
      throw new NotFoundException(`Cold room ${id} not found`);
    }

    this.assertValidRange(
      updateColdRoomDto.tempMin ?? coldRoom.tempMin,
      updateColdRoomDto.tempMax ?? coldRoom.tempMax,
    );

    Object.assign(coldRoom, updateColdRoomDto);
    return this.saveColdRoom(coldRoom);
  }

  async remove(id: string) {
    const result = await this.coldRoomsRepository.softDelete(id);
    if (!result.affected) {
      throw new NotFoundException(`Cold room ${id} not found`);
    }
  }

  bulkRemove(ids: string[]): Promise<BulkDeleteResult> {
    return bulkDelete(ids, (id) => this.remove(id));
  }
}
