import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { ObjectLiteral, Repository } from 'typeorm';
import {
  ROLES_KEY,
  WAREHOUSE_LIST_SCOPE_KEY,
  WAREHOUSE_SCOPE_KEY,
} from '../../libs/constants/metadata.constant';
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
import type { WarehouseListScopeMeta } from '../decorators/warehouse-list-scope.decorator';
import type { WarehouseScopeMeta } from '../decorators/warehouse-scope.decorator';
import type { WarehouseAccess } from '../rbac/warehouse-access';
import { WarehouseAccessService } from '../rbac/warehouse-access.service';

interface RequestWithAuth {
  user?: { id: string; role: UserRole };
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  warehouseAccess?: WarehouseAccess;
}

// Enforces "Phạm vi" (warehouse scope) and "Ca trực" (shift scope) from
// docs/rbac.md §3-4. Admin always bypasses. For everyone else the role that
// counts on a warehouse-scoped route is their role *in that warehouse*
// (warehouse_staff.role), checked here against @Roles — RolesGuard skips
// its global-role check on these routes (see roles.guard.ts).
//   - @WarehouseScope():     one resource; rejects unless allowed.
//   - @WarehouseListScope(): a list; never rejects, attaches the readable
//                            warehouses as request.warehouseAccess.
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
    private readonly warehouseAccess: WarehouseAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const meta = this.reflector.getAllAndOverride<WarehouseScopeMeta>(
      WAREHOUSE_SCOPE_KEY,
      targets,
    );
    const listMeta = this.reflector.getAllAndOverride<WarehouseListScopeMeta>(
      WAREHOUSE_LIST_SCOPE_KEY,
      targets,
    );
    if (!meta && !listMeta) return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const user = request.user;
    if (!user) throw new UnauthorizedException('User not found in request');
    const requiredRoles = this.reflector.getAllAndOverride<
      UserRole[] | undefined
    >(ROLES_KEY, targets);

    if (listMeta) {
      request.warehouseAccess = await this.warehouseAccess.resolve(
        user,
        requiredRoles,
        { requireShift: listMeta.requireShift },
      );
      return true;
    }
    if (!meta || user.role === UserRole.ADMIN) return true;

    const warehouseId = await this.resolveWarehouseId(meta, request);
    if (!warehouseId) {
      throw new ForbiddenException(
        'Resource is not assigned to any warehouse you can access',
      );
    }

    const assignment = await this.warehouseStaffRepo.findOne({
      where: { userId: user.id, warehouseId },
    });
    if (!assignment) {
      throw new ForbiddenException('Not assigned to this warehouse');
    }
    if (requiredRoles?.length && !requiredRoles.includes(assignment.role)) {
      throw new ForbiddenException(
        'Your role in this warehouse does not allow this action',
      );
    }
    const actsAsStaff = assignment.role === UserRole.STAFF;

    if (meta.ownStaffOnly && actsAsStaff) {
      const params = request.params ?? {};
      const workShift = await this.workShiftRepo.findOne({
        where: { id: params[meta.paramName] },
      });
      if (workShift?.staffId !== user.id) {
        throw new ForbiddenException('Can only act on your own work shift');
      }
    }

    if (meta.requireShift && actsAsStaff) {
      const activeIds = await this.warehouseAccess.warehousesWithActiveShift(
        user.id,
        [warehouseId],
      );
      if (activeIds.length === 0) {
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
        return this.warehouseIdVia(
          this.coldRoomRepo,
          [],
          params[meta.paramName],
        );

      case WarehouseScopeSource.COLD_ROOM_BODY:
        return this.warehouseIdVia(
          this.coldRoomRepo,
          [],
          body[meta.paramName] as string,
        );

      case WarehouseScopeSource.DEVICE_PARAM:
        return this.warehouseIdVia(
          this.deviceRepo,
          ['coldRoom'],
          params[meta.paramName],
        );

      case WarehouseScopeSource.BATCH_PARAM:
        return this.warehouseIdVia(
          this.batchRepo,
          ['coldRoom'],
          params[meta.paramName],
        );

      case WarehouseScopeSource.ALERT_PARAM:
        return this.warehouseIdVia(
          this.alertRepo,
          ['coldRoom'],
          params[meta.paramName],
        );

      case WarehouseScopeSource.COMMAND_PARAM:
        return this.warehouseIdVia(
          this.commandRepo,
          ['channel', 'device', 'coldRoom'],
          params[meta.paramName],
        );

      case WarehouseScopeSource.CHANNEL_BODY:
        return this.warehouseIdVia(
          this.deviceChannelRepo,
          ['device', 'coldRoom'],
          body[meta.paramName] as string,
        );

      case WarehouseScopeSource.WORK_SHIFT_PARAM:
        return this.warehouseIdVia(
          this.workShiftRepo,
          [],
          params[meta.paramName],
        );

      default:
        return null;
    }
  }

  // Resolves the owning warehouse in ONE query: starts at the target row
  // and INNER JOINs along `relations` (entity relation names, e.g.
  // ['channel', 'device', 'coldRoom'] from a command) to the entity that
  // carries warehouse_id — instead of one findOne per hop. warehouse_id
  // still lives only on cold_rooms (and work_shifts); nothing is copied
  // down the chain, so a device moved to another room is always judged by
  // its current room.
  //
  // Returns null when the row doesn't exist, a hop is missing (e.g. an
  // unclaimed device with no cold room — the INNER JOIN drops it) or a row
  // on the path is soft-deleted (TypeORM adds `deleted_at IS NULL` for the
  // root and every joined entity that has a DeleteDateColumn).
  private async warehouseIdVia(
    repo: Repository<ObjectLiteral>,
    relations: string[],
    id: string | null | undefined,
  ): Promise<string | null> {
    if (!id) return null;
    let query = repo.createQueryBuilder('target');
    let last = 'target';
    relations.forEach((relation, index) => {
      const alias = `hop${index}`;
      query = query.innerJoin(`${last}.${relation}`, alias);
      last = alias;
    });
    const row = await query
      .select(`${last}.warehouseId`, 'warehouseId')
      .where('target.id = :id', { id })
      .getRawOne<{ warehouseId: string | null }>();
    return row?.warehouseId ?? null;
  }
}
