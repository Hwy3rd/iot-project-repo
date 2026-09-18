import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Warehouse } from '../warehouses/entities/warehouse.entity';
import { CreateColdRoomDto } from './dto/create-cold-room.dto';
import { UpdateColdRoomDto } from './dto/update-cold-room.dto';
import { ColdRoom } from './entities/cold-room.entity';

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

  findAll() {
    return this.coldRoomsRepository.find();
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
}
