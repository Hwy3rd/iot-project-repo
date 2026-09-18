import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { BatchStatus } from '../../libs/constants/batch.constant';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { ProductType } from '../product-types/entities/product-type.entity';
import { CreateBatchDto } from './dto/create-batch.dto';
import { UpdateBatchDto } from './dto/update-batch.dto';
import { Batch } from './entities/batch.entity';

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

  findAll() {
    return this.batchesRepository.find();
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
}
