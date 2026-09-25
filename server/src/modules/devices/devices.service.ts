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
  narrowWarehouseIds,
  withSearch,
} from '../../common/query/find-filters';
import { QueryDeviceDto } from './dto/query-device.dto';
import type { WarehouseAccess } from '../../common/rbac/warehouse-access';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import {
  FindOptionsWhere,
  In,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { DeviceStatus } from '../../libs/constants/device.constant';
import { ColdRoom } from '../cold-rooms/entities/cold-room.entity';
import { ClaimDeviceDto } from './dto/claim-device.dto';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { Device } from './entities/device.entity';

const CLAIM_CODE_SALT_ROUNDS = 10;
const CLAIM_CODE_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
    @InjectRepository(ColdRoom)
    private readonly coldRoomsRepository: Repository<ColdRoom>,
  ) {}

  private async saveDevice(device: Device): Promise<Device> {
    try {
      return await this.devicesRepository.save(device);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as unknown as { code?: string }).code === 'ER_DUP_ENTRY'
      ) {
        throw new ConflictException('Device unique_id already in use');
      }
      throw error;
    }
  }

  create(createDeviceDto: CreateDeviceDto) {
    const device = this.devicesRepository.create({
      uniqueId: createDeviceDto.uniqueId,
      firmwareVersion: createDeviceDto.firmwareVersion ?? null,
    });
    return this.saveDevice(device);
  }

  // access omitted = unfiltered (internal callers); see WarehouseAccess.
  // Unclaimed devices (no cold room) belong to no warehouse, so only an
  // unrestricted caller (Admin) sees them.
  async findAll(
    access?: WarehouseAccess,
    query: QueryDeviceDto = {},
  ): Promise<Paginated<Device>> {
    const ids = narrowWarehouseIds(access?.warehouseIds, query.warehouseId);
    if (ids?.length === 0) return Paginated.empty(query);
    const where: FindOptionsWhere<Device> = {};
    if (ids) where.coldRoom = { warehouseId: In(ids) };
    if (query.status) where.status = query.status;
    if (query.coldRoomId) where.coldRoomId = query.coldRoomId;
    // Unclaimed devices have no warehouse, so this finds none for a scoped
    // caller or alongside warehouseId/coldRoomId — same as visibility rules.
    if (query.unassigned === 'true') where.coldRoomId = IsNull();
    const pagination = resolvePagination(query);
    const [items, total] = await this.devicesRepository.findAndCount({
      where: withSearch(where, query.search, ['uniqueId', 'firmwareVersion']),
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }

  async findOne(id: string) {
    const device = await this.devicesRepository.findOne({ where: { id } });
    if (!device) {
      throw new NotFoundException(`Device ${id} not found`);
    }
    return device;
  }

  async update(id: string, updateDeviceDto: UpdateDeviceDto) {
    const device = await this.findOne(id);
    Object.assign(device, updateDeviceDto);
    return this.saveDevice(device);
  }

  async generateClaimCode(id: string) {
    const device = await this.findOne(id);
    if (
      device.status !== DeviceStatus.REGISTERED &&
      device.status !== DeviceStatus.PROVISIONED
    ) {
      throw new ConflictException(
        `Device ${id} cannot generate a claim code from status ${device.status}`,
      );
    }

    const claimCode = randomInt(100000, 999999).toString();
    device.claimCodeHash = await bcrypt.hash(claimCode, CLAIM_CODE_SALT_ROUNDS);
    device.claimCodeExpiresAt = new Date(Date.now() + CLAIM_CODE_TTL_MS);
    device.status = DeviceStatus.PROVISIONED;
    await this.devicesRepository.save(device);

    return {
      claimCode,
      claimCodeExpiresAt: device.claimCodeExpiresAt,
    };
  }

  async claim(id: string, claimDeviceDto: ClaimDeviceDto) {
    const device = await this.findOne(id);
    if (device.status !== DeviceStatus.PROVISIONED) {
      throw new ConflictException(
        `Device ${id} cannot be claimed from status ${device.status}`,
      );
    }
    if (
      !device.claimCodeHash ||
      !device.claimCodeExpiresAt ||
      device.claimCodeExpiresAt < new Date()
    ) {
      throw new BadRequestException('Claim code has expired');
    }

    const matches = await bcrypt.compare(
      claimDeviceDto.claimCode,
      device.claimCodeHash,
    );
    if (!matches) {
      throw new BadRequestException('Invalid claim code');
    }

    const coldRoom = await this.coldRoomsRepository.findOne({
      where: { id: claimDeviceDto.coldRoomId },
    });
    if (!coldRoom) {
      throw new NotFoundException(
        `Cold room ${claimDeviceDto.coldRoomId} not found`,
      );
    }

    device.coldRoomId = claimDeviceDto.coldRoomId;
    device.status = DeviceStatus.ACTIVE;
    device.claimedAt = new Date();
    device.claimCodeHash = null;
    device.claimCodeExpiresAt = null;
    return this.devicesRepository.save(device);
  }

  async decommission(id: string) {
    const device = await this.findOne(id);
    if (device.status === DeviceStatus.DECOMMISSIONED) {
      throw new ConflictException(`Device ${id} is already decommissioned`);
    }
    device.status = DeviceStatus.DECOMMISSIONED;
    device.decommissionedAt = new Date();
    return this.devicesRepository.save(device);
  }

  async remove(id: string) {
    const result = await this.devicesRepository.softDelete(id);
    if (!result.affected) {
      throw new NotFoundException(`Device ${id} not found`);
    }
  }
}
