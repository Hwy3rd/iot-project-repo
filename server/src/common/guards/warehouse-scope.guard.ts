import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { WAREHOUSE_SCOPE_KEY } from '../../libs/constants/metadata.constant';
import { UserRole } from '../../libs/constants/user.constant';
import { WarehouseScopeSource } from '../../libs/constants/warehouse-scope.constant';
import { Alert } from '../../modules/alerts/entities/alert.entity';
import { Batch } from '../../modules/batches/entities/batch.entity';
import { ColdRoom } from '../../modules/cold-rooms/entities/cold-room.entity';
import { Command } from '../../modules/commands/entities/command.entity';
import { DeviceChannel } from '../../modules/device-channels/entities/device-channel.entity';
import { Device } from '../../modules/devices/entities/device.entity';
import { WarehouseStaff } from '../../modules/warehouses/entities/warehouse-staff.entity';
import { WorkShift } from '../../modules/work-shifts/entities/work-shift.entity';
import type { WarehouseScopeMeta } from '../decorators/warehouse-scope.decorator';

interface RequestWithAuth {
  user?: { id: string; role: UserRole };
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}

// Enforces "Phạm vi" (warehouse scope) and "Ca trực" (shift scope) from
// docs/rbac.md §3-4. No-ops on routes without @WarehouseScope(); Admin
// always bypasses. Must run after RolesGuard has already confirmed the
// caller's role is allowed on this route — this guard only narrows *which*
// warehouse/resource within that role's permission the caller may touch.
@Injectable()
export class WarehouseScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(WarehouseStaff)
    private readonly warehouseStaffRepo: Repository<WarehouseStaff>,
    @InjectRepository(ColdRoom)
    private readonly coldRoomRepo: Repository<ColdRoom>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(Batch)
    private readonly batchRepo: Repository<Batch>,
    @InjectRepository(Alert)
    private readonly alertRepo: Repository<Alert>,
    @InjectRepository(Command)
    private readonly commandRepo: Repository<Command>,
    @InjectRepository(DeviceChannel)
    private readonly deviceChannelRepo: Repository<DeviceChannel>,
    @InjectRepository(WorkShift)
    private readonly workShiftRepo: Repository<WorkShift>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<WarehouseScopeMeta>(
      WAREHOUSE_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('User not found in request');
    if (user.role === UserRole.ADMIN) return true;

    const warehouseId = await this.resolveWarehouseId(meta, request);
    if (!warehouseId) {
      throw new ForbiddenException(
        'Resource is not assigned to any warehouse you can access',
      );
    }

    const isAssigned = await this.warehouseStaffRepo.existsBy({
      userId: user.id,
      warehouseId,
    });
    if (!isAssigned) {
      throw new ForbiddenException('Not assigned to this warehouse');
    }

    if (meta.ownStaffOnly && user.role === UserRole.STAFF) {
      const params = request.params ?? {};
      const workShift = await this.workShiftRepo.findOne({
        where: { id: params[meta.paramName] },
      });
      if (workShift?.staffId !== user.id) {
        throw new ForbiddenException('Can only act on your own work shift');
      }
    }

    if (meta.requireShift && user.role === UserRole.STAFF) {
      const hasActiveShift = await this.workShiftRepo.existsBy({
        staffId: user.id,
        warehouseId,
        checkInAt: Not(IsNull()),
        checkOutAt: IsNull(),
      });
      if (!hasActiveShift) {
        throw new ForbiddenException(
          'Requires an active checked-in work shift for this warehouse',
        );
      }
    }

    return true;
  }

  private async resolveWarehouseId(
    meta: WarehouseScopeMeta,
    request: {
      params?: Record<string, string>;
      body?: Record<string, unknown>;
    },
  ): Promise<string | null> {
    const params = request.params ?? {};
    const body = request.body ?? {};

    switch (meta.source) {
      case WarehouseScopeSource.WAREHOUSE_PARAM:
        return params[meta.paramName] ?? null;

      case WarehouseScopeSource.WAREHOUSE_BODY:
        return (body[meta.paramName] as string) ?? null;

      case WarehouseScopeSource.COLD_ROOM_PARAM:
        return this.warehouseIdOfColdRoom(params[meta.paramName]);

      case WarehouseScopeSource.COLD_ROOM_BODY:
        return this.warehouseIdOfColdRoom(body[meta.paramName] as string);

      case WarehouseScopeSource.DEVICE_PARAM:
        return this.warehouseIdOfDevice(params[meta.paramName]);

      case WarehouseScopeSource.BATCH_PARAM: {
        const batch = await this.batchRepo.findOne({
          where: { id: params[meta.paramName] },
        });
        return batch ? this.warehouseIdOfColdRoom(batch.coldRoomId) : null;
      }

      case WarehouseScopeSource.ALERT_PARAM: {
        const alert = await this.alertRepo.findOne({
          where: { id: params[meta.paramName] },
        });
        return alert ? this.warehouseIdOfColdRoom(alert.coldRoomId) : null;
      }

      case WarehouseScopeSource.COMMAND_PARAM: {
        const command = await this.commandRepo.findOne({
          where: { id: params[meta.paramName] },
        });
        if (!command) return null;
        return this.warehouseIdOfChannel(command.channelId);
      }

      case WarehouseScopeSource.CHANNEL_BODY: {
        const channelId = body[meta.paramName] as string;
        if (!channelId) return null;
        return this.warehouseIdOfChannel(channelId);
      }

      case WarehouseScopeSource.WORK_SHIFT_PARAM: {
        const workShift = await this.workShiftRepo.findOne({
          where: { id: params[meta.paramName] },
        });
        return workShift?.warehouseId ?? null;
      }

      default:
        return null;
    }
  }

  private async warehouseIdOfColdRoom(
    coldRoomId: string | null | undefined,
  ): Promise<string | null> {
    if (!coldRoomId) return null;
    const coldRoom = await this.coldRoomRepo.findOne({
      where: { id: coldRoomId },
    });
    return coldRoom?.warehouseId ?? null;
  }

  private async warehouseIdOfDevice(
    deviceId: string | null | undefined,
  ): Promise<string | null> {
    if (!deviceId) return null;
    const device = await this.deviceRepo.findOne({ where: { id: deviceId } });
    if (!device?.coldRoomId) return null;
    return this.warehouseIdOfColdRoom(device.coldRoomId);
  }

  private async warehouseIdOfChannel(
    channelId: string | null | undefined,
  ): Promise<string | null> {
    if (!channelId) return null;
    const channel = await this.deviceChannelRepo.findOne({
      where: { id: channelId },
    });
    if (!channel) return null;
    return this.warehouseIdOfDevice(channel.deviceId);
  }
}
