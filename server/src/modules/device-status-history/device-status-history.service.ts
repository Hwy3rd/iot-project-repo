import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Paginated,
  resolvePagination,
} from '../../common/pagination/paginated';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DeviceStatus,
  DeviceStatusChangeTrigger,
} from '../../libs/constants/device.constant';
import { Device } from '../devices/entities/device.entity';
import { DeviceStatusHistory } from './entities/device-status-history.entity';

export interface RecordDeviceStatusChangeInput {
  deviceId: string;
  oldStatus: DeviceStatus | null;
  newStatus: DeviceStatus;
  trigger: DeviceStatusChangeTrigger;
  changedBy?: string | null;
  reason?: string | null;
}

@Injectable()
export class DeviceStatusHistoryService {
  constructor(
    @InjectRepository(DeviceStatusHistory)
    private readonly historyRepository: Repository<DeviceStatusHistory>,
    @InjectRepository(Device)
    private readonly devicesRepository: Repository<Device>,
  ) {}

  // Not exposed over HTTP — meant to be called by DevicesService (not wired
  // up yet) at the same time it changes device.status, ideally in the same
  // transaction so the two can never drift apart. Trusts the caller for
  // deviceId (it already has the Device loaded when transitioning it), same
  // convention as AlertsService.raise() trusting deviceId/batchId.
  async record(
    input: RecordDeviceStatusChangeInput,
  ): Promise<DeviceStatusHistory> {
    if (input.oldStatus === input.newStatus) {
      // Programmer error, not user input — e.g. calling this from a status
      // "refresh" that didn't actually change anything (see
      // DevicesService.generateClaimCode(), which can re-set PROVISIONED on
      // a device already PROVISIONED — that call site must not reach here).
      throw new Error(
        `record() called with no actual status change (${input.newStatus})`,
      );
    }

    const entry = this.historyRepository.create({
      deviceId: input.deviceId,
      oldStatus: input.oldStatus,
      newStatus: input.newStatus,
      trigger: input.trigger,
      changedBy: input.changedBy ?? null,
      reason: input.reason ?? null,
    });
    return this.historyRepository.save(entry);
  }

  // Backs GET /devices/:deviceId/status-history.
  async findAllForDevice(
    deviceId: string,
    query: PaginationQueryDto = {},
  ): Promise<Paginated<DeviceStatusHistory>> {
    const exists = await this.devicesRepository.existsBy({ id: deviceId });
    if (!exists) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }
    const pagination = resolvePagination(query);
    const [items, total] = await this.historyRepository.findAndCount({
      where: { deviceId },
      order: { changedAt: 'DESC', id: 'DESC' },
      skip: pagination.skip,
      take: pagination.take,
    });
    return Paginated.of(items, total, pagination);
  }
}
