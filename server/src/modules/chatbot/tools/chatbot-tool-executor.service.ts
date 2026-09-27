import { ForbiddenException, Injectable } from '@nestjs/common';
import { Paginated } from '../../../common/pagination/paginated';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, LessThanOrEqual, Repository } from 'typeorm';
import { AlertStatus } from '../../../libs/constants/alert.constant';
import { BatchStatus } from '../../../libs/constants/batch.constant';
import { CHATBOT_TIMEZONE } from '../../../libs/constants/chatbot.constant';
import { DeviceStatus } from '../../../libs/constants/device.constant';
import { UserRole } from '../../../libs/constants/user.constant';
import type { QueryAlertDto } from '../../alerts/dto/query-alert.dto';
import { AlertsService } from '../../alerts/alerts.service';
import { Alert } from '../../alerts/entities/alert.entity';
import { Batch } from '../../batches/entities/batch.entity';
import { ColdRoomStatusService } from '../../cold-rooms/cold-room-status.service';
import { ColdRoom } from '../../cold-rooms/entities/cold-room.entity';
import { Command } from '../../commands/entities/command.entity';
import { DeviceChannel } from '../../device-channels/entities/device-channel.entity';
import { DeviceStatusHistoryService } from '../../device-status-history/device-status-history.service';
import { Device } from '../../devices/entities/device.entity';
import { ProductType } from '../../product-types/entities/product-type.entity';
import { TelemetryService } from '../../telemetry/telemetry.service';
import { Warehouse } from '../../warehouses/entities/warehouse.entity';
import { WorkShift } from '../../work-shifts/entities/work-shift.entity';
import { searchChatbotDocs } from './chatbot-docs-search';
import {
  UNRESTRICTED_ACCESS,
  type WarehouseAccess,
} from '../../../common/rbac/warehouse-access';
import { WarehouseAccessService } from '../../../common/rbac/warehouse-access.service';
import { CHATBOT_TOOLS } from './chatbot-tools.definitions';

export interface ChatbotToolCaller {
  id: string;
  role: UserRole;
  // Set by execute() for the running tool — resolved by the same
  // WarehouseAccessService the REST list routes use, from the tool's
  // allowedRoles/requireShift, so a tool never sees more than its REST
  // counterpart (docs/RBAC.md §3).
  access?: WarehouseAccess;
  // The warehouse picked in the app header (see resolveWorkingWarehouse):
  // breaks ties when a room name matches rooms in several warehouses. Not a
  // filter — tools still reach every warehouse in `access`.
  workingWarehouseId?: string;
}

// Tools reading data that belongs to no warehouse (shared catalogue,
// business docs) — every other tool is warehouse-scoped.
const GLOBAL_DATA_TOOLS = new Set(['get_product_types', 'search_docs']);

export interface ChatbotToolResult {
  result?: unknown;
  error?: string;
}

// Thrown internally to short-circuit a handler with a message meant for the
// LLM (via the tool result), not a stack trace — always caught by execute()
// and turned into { error }, never allowed to escape as an HTTP exception,
// since a tool failure is normal conversational flow ("bạn không có quyền
// xem..."), not a request-level error.
class ChatbotToolError extends Error {}

// Exported so the orchestrator can exclude these from the tool list sent to
// the LLM in the first place — no point advertising a tool that always
// errors, and it stops the model wasting a turn attempting one.
export const CHATBOT_TOOLS_NOT_IMPLEMENTED = new Set([
  'get_inventory_summary',
  'get_staff_performance_summary',
  'get_previous_shift_summary',
]);

// Same as the frontend's "Mất tín hiệu" (frontend/src/lib/room-status.ts).
const STALE_AFTER_MS = 10 * 60_000;
// Telemetry for a room covers at most this many of its devices.
const MAX_ROOM_TELEMETRY_DEVICES = 5;
// Caps for the lists inside get_system_health_summary.
const MAX_SUMMARY_ITEMS = 30;
// Candidates listed when a name matches several rooms/warehouses.
const MAX_AMBIGUOUS = 8;

const ACTIVE_ALERT_STATUSES = [AlertStatus.OPEN, AlertStatus.ACKNOWLEDGED];
const PROBLEM_DEVICE_STATUSES = [
  DeviceStatus.OFFLINE,
  DeviceStatus.FAULT,
  DeviceStatus.MAINTENANCE,
];

// The warehouses and cold rooms a tool call may read, loaded once per call.
// Every id/name/code the model supplies is resolved against it, so anything
// outside the caller's warehouses is simply "not found" — and results can
// name rooms and warehouses without a query per row.
interface Scope {
  // null = unrestricted (Admin).
  assigned: string[] | null;
  warehouses: Map<string, Warehouse>;
  rooms: Map<string, ColdRoom>;
  // ChatbotToolCaller.workingWarehouseId: wins ties between same-named rooms.
  preferredWarehouseId?: string;
}

// Executes a tool call the LLM asked for, after enforcing the
// allowedRoles/scope declared on it in chatbot-tools.definitions.ts.
//
// Deliberately injects repositories directly for the simple entities
// (Device, Batch, ColdRoom, Warehouse, ProductType, Command, DeviceChannel,
// WorkShift, Alert) rather than the modules' own services — those modules
// don't export their services (only AlertsModule/TelemetryModule/
// DeviceStatusHistoryModule/ColdRoomsModule do), and this matches the
// existing convention of cross-module reads going straight through
// repositories (see NotificationsService, which does the same for
// ColdRoom/WarehouseStaff).
//
// Results are shaped for the model, not the database: only the fields an
// answer needs, rooms/warehouses/devices by name rather than id, and lists
// capped with their total — fewer tokens, and no follow-up call just to turn
// an id into a name.
//
// Guards (JwtAuthGuard/RolesGuard/WarehouseScopeGuard) never run here —
// they only fire on the HTTP pipeline (see RbacModule) — so every branch
// below re-derives and checks scope itself before touching data: never
// trust an id the LLM supplied without verifying it resolves to a
// warehouse the caller is assigned to.
@Injectable()
export class ChatbotToolExecutorService {
  constructor(
    private readonly alertsService: AlertsService,
    private readonly telemetryService: TelemetryService,
    private readonly deviceStatusHistoryService: DeviceStatusHistoryService,
    @InjectRepository(Device)
    private readonly devicesRepo: Repository<Device>,
    @InjectRepository(Batch)
    private readonly batchesRepo: Repository<Batch>,
    @InjectRepository(ColdRoom)
    private readonly coldRoomsRepo: Repository<ColdRoom>,
    @InjectRepository(Warehouse)
    private readonly warehousesRepo: Repository<Warehouse>,
    @InjectRepository(ProductType)
    private readonly productTypesRepo: Repository<ProductType>,
    @InjectRepository(Command)
    private readonly commandsRepo: Repository<Command>,
    @InjectRepository(DeviceChannel)
    private readonly deviceChannelsRepo: Repository<DeviceChannel>,
    @InjectRepository(WorkShift)
    private readonly workShiftsRepo: Repository<WorkShift>,
    private readonly warehouseAccess: WarehouseAccessService,
    private readonly coldRoomStatus: ColdRoomStatusService,
    @InjectRepository(Alert)
    private readonly alertsRepo: Repository<Alert>,
  ) {}

  async execute(
    name: string,
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ): Promise<ChatbotToolResult> {
    const def = CHATBOT_TOOLS.find((tool) => tool.name === name);
    if (!def) {
      return { error: `Không tồn tại tool "${name}".` };
    }
    if (CHATBOT_TOOLS_NOT_IMPLEMENTED.has(name)) {
      return {
        error: `Chức năng "${name}" chưa được triển khai ở phiên bản hiện tại.`,
      };
    }

    const access = await this.warehouseAccess.resolve(
      caller,
      def.allowedRoles,
      { requireShift: def.requireShift },
    );
    // Warehouse data tools: usable only if at least one warehouse is
    // reachable under the tool's roles/shift rule — the caller's global
    // role doesn't count, same as the REST routes. Only the two tools with
    // no warehouse data at all are gated on the global role.
    const usable =
      caller.role === UserRole.ADMIN ||
      (GLOBAL_DATA_TOOLS.has(name)
        ? def.allowedRoles.includes(caller.role)
        : (access.warehouseIds?.length ?? 0) > 0);
    if (!usable) {
      return {
        error: def.requireShift
          ? 'Bạn không có quyền sử dụng chức năng này (nhân viên cần đang trong ca trực đã check-in tại kho).'
          : 'Bạn không có quyền sử dụng chức năng này.',
      };
    }

    try {
      const result = await this.dispatch(name, args, { ...caller, access });
      return { result };
    } catch (error) {
      if (error instanceof ChatbotToolError) {
        return { error: error.message };
      }
      // NotFoundException etc. from AlertsService/TelemetryService — reuse
      // their message, which is already safe/user-facing (see e.g.
      // AlertsService.findOne, TelemetryService.assertDeviceExists).
      if (error instanceof Error) {
        return { error: error.message };
      }
      return { error: 'Đã xảy ra lỗi không xác định khi thực thi tool.' };
    }
  }

  // The header's warehouse for a chat turn, if the caller may read it —
  // checked against their assignments (any role), like GET /warehouses/:id.
  // Same 403 whether it doesn't exist or isn't theirs.
  async resolveWorkingWarehouse(
    caller: ChatbotToolCaller,
    warehouseId: string,
  ): Promise<Warehouse> {
    const access = await this.warehouseAccess.resolve(caller, undefined);
    const warehouse =
      access.warehouseIds === null || access.warehouseIds.includes(warehouseId)
        ? await this.warehousesRepo.findOne({ where: { id: warehouseId } })
        : null;
    if (!warehouse) {
      throw new ForbiddenException('Bạn không được phân công vào kho này.');
    }
    return warehouse;
  }

  private dispatch(
    name: string,
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ): Promise<unknown> {
    switch (name) {
      case 'get_alerts':
        return this.getAlerts(args, caller);
      case 'get_alert_detail':
        return this.getAlertDetail(args, caller);
      case 'get_devices':
        return this.getDevices(args, caller);
      case 'get_device_detail':
        return this.getDeviceDetail(args, caller);
      case 'get_device_status_history':
        return this.getDeviceStatusHistory(args, caller);
      case 'get_telemetry_hourly':
        return this.getTelemetry('hourly', args, caller);
      case 'get_telemetry_raw':
        return this.getTelemetry('raw', args, caller);
      case 'get_batches':
        return this.getBatches(args, caller);
      case 'get_batch_detail':
        return this.getBatchDetail(args, caller);
      case 'get_cold_rooms':
        return this.getColdRooms(args, caller);
      case 'get_cold_room_detail':
        return this.getColdRoomDetail(args, caller);
      case 'get_warehouses':
        return this.getWarehouses(caller);
      case 'get_product_types':
        return this.getProductTypes();
      case 'get_commands':
        return this.getCommands(args, caller);
      case 'get_work_shifts':
        return this.getWorkShifts(args, caller);
      case 'get_system_health_summary':
        return this.getSystemHealthSummary(args, caller);
      case 'search_docs':
        return Promise.resolve(this.searchDocs(args));
      default:
        throw new ChatbotToolError(`Tool "${name}" chưa có handler thực thi.`);
    }
  }

  // ---------------------------------------------------------------------
  // Scope
  // ---------------------------------------------------------------------

  // null = unrestricted (Admin). Never null and empty at once — empty means
  // "no warehouse where this tool's data is reachable for you right now"
  // (not assigned, wrong role, or — for Staff on requireShift tools —
  // not checked in).
  private async getAssignedWarehouseIds(
    caller: ChatbotToolCaller,
  ): Promise<string[] | null> {
    const access =
      caller.access ?? (await this.warehouseAccess.resolve(caller, undefined));
    return access.warehouseIds;
  }

  // Of the caller's reachable warehouses, those where they act as Staff.
  private getStaffWarehouseIds(caller: ChatbotToolCaller): string[] {
    return caller.access?.staffWarehouseIds ?? [];
  }

  private async loadScope(caller: ChatbotToolCaller): Promise<Scope> {
    const assigned = await this.getAssignedWarehouseIds(caller);
    if (assigned?.length === 0) {
      return { assigned, warehouses: new Map(), rooms: new Map() };
    }
    const [warehouses, rooms] = await Promise.all([
      this.warehousesRepo.find({
        where: assigned ? { id: In(assigned) } : {},
        order: { code: 'ASC' },
      }),
      this.coldRoomsRepo.find({
        where: assigned ? { warehouseId: In(assigned) } : {},
        order: { name: 'ASC' },
      }),
    ]);
    return {
      assigned,
      warehouses: new Map(warehouses.map((w) => [w.id, w])),
      rooms: new Map(rooms.map((r) => [r.id, r])),
      preferredWarehouseId: caller.workingWarehouseId,
    };
  }

  // The same message whether the thing doesn't exist or is someone else's,
  // same reasoning as NotificationsService.markRead not telling "not found"
  // from "belongs to someone else".
  private notFound(kind: string, ref: string): ChatbotToolError {
    return new ChatbotToolError(
      `Không tìm thấy ${kind} "${ref}" hoặc bạn không có quyền truy cập tài nguyên này.`,
    );
  }

  private resolveWarehouse(scope: Scope, ref: string): Warehouse {
    const byId = scope.warehouses.get(ref);
    if (byId) return byId;
    return pickByName(
      [...scope.warehouses.values()],
      ref,
      (w) => [w.code, w.name],
      (w) => `${w.name} (${w.code})`,
      'kho',
      () => this.notFound('kho', ref),
    );
  }

  private resolveColdRoom(
    scope: Scope,
    ref: string,
    warehouseId?: string,
  ): ColdRoom {
    const byId = scope.rooms.get(ref);
    if (byId && (!warehouseId || byId.warehouseId === warehouseId)) {
      return byId;
    }
    const candidates = [...scope.rooms.values()].filter(
      (r) => !warehouseId || r.warehouseId === warehouseId,
    );
    return pickByName(
      candidates,
      ref,
      (r) => [r.name],
      (r) => `${r.name} (${this.warehouseCode(scope, r.warehouseId)})`,
      'phòng lạnh',
      () => this.notFound('phòng lạnh', ref),
      scope.preferredWarehouseId
        ? (r) => r.warehouseId === scope.preferredWarehouseId
        : undefined,
    );
  }

  // Unclaimed devices (no room) belong to no warehouse, so no one reaches
  // them through the chatbot — same as before, even for Admin.
  private async resolveDevice(scope: Scope, ref: string): Promise<Device> {
    const device = await this.devicesRepo.findOne({
      where: [{ id: ref }, { uniqueId: ref }],
    });
    if (!device?.coldRoomId || !scope.rooms.has(device.coldRoomId)) {
      throw this.notFound('thiết bị', ref);
    }
    return device;
  }

  private async resolveBatch(scope: Scope, ref: string): Promise<Batch> {
    const batch = await this.batchesRepo.findOne({
      where: [{ id: ref }, { batchCode: ref }],
      relations: { productType: true },
    });
    if (!batch || !scope.rooms.has(batch.coldRoomId)) {
      throw this.notFound('lô hàng', ref);
    }
    return batch;
  }

  // The rooms a list tool covers after its warehouseId/coldRoomId filters.
  private roomsFor(scope: Scope, args: Record<string, unknown>): ColdRoom[] {
    const warehouseRef = this.optionalString(args, 'warehouseId');
    const roomRef = this.optionalString(args, 'coldRoomId');
    const warehouseId = warehouseRef
      ? this.resolveWarehouse(scope, warehouseRef).id
      : undefined;
    if (roomRef) return [this.resolveColdRoom(scope, roomRef, warehouseId)];
    const rooms = [...scope.rooms.values()];
    return warehouseId
      ? rooms.filter((r) => r.warehouseId === warehouseId)
      : rooms;
  }

  private warehouseCode(scope: Scope, warehouseId: string): string | null {
    return scope.warehouses.get(warehouseId)?.code ?? null;
  }

  // Where a row lives, by name — what answers need instead of ids.
  private location(scope: Scope, coldRoomId: string | null) {
    const room = coldRoomId ? scope.rooms.get(coldRoomId) : undefined;
    return {
      coldRoom: room?.name ?? null,
      warehouse: room ? this.warehouseCode(scope, room.warehouseId) : null,
    };
  }

  // ---------------------------------------------------------------------
  // Argument helpers
  // ---------------------------------------------------------------------

  // Out-of-range values are clamped by resolvePagination(), so anything
  // numeric from the model is safe to pass through.
  private pagination(args: Record<string, unknown>): PaginationQueryDto {
    return { page: toInt(args.page), limit: toInt(args.limit) };
  }

  private limit(args: Record<string, unknown>, fallback: number, max: number) {
    const value = toInt(args.limit);
    return value === undefined ? fallback : Math.min(Math.max(value, 1), max);
  }

  private requireString(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ChatbotToolError(`Thiếu tham số bắt buộc "${key}".`);
    }
    return value.trim();
  }

  private optionalString(
    args: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = args[key];
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  // Date-only filters (createdBetween) take YYYY-MM-DD; the model may send a
  // full ISO datetime, whose date part is what it meant.
  private optionalDate(
    args: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = this.optionalString(args, key);
    if (!value) return undefined;
    const date = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
    if (!date) {
      throw new ChatbotToolError(
        `Tham số "${key}" phải có dạng YYYY-MM-DD (nhận được "${value}").`,
      );
    }
    return date;
  }

  // ---------------------------------------------------------------------
  // Views — what the model gets back for each kind of row
  // ---------------------------------------------------------------------

  private roomView(scope: Scope, room: ColdRoom) {
    return compact({
      id: room.id,
      name: room.name,
      warehouse: this.warehouseCode(scope, room.warehouseId),
      tempMin: room.tempMin,
      tempMax: room.tempMax,
      hysteresis: room.hysteresis,
      doorOpenMaxSeconds: room.doorOpenMaxSeconds,
      capacityPallets: room.capacityPallets,
      capacityWeightKg: room.capacityWeightKg,
      capacityVolumeM3: room.capacityVolumeM3,
    });
  }

  // Never includes claim_code_hash/claim_code_expires_at — activation
  // secrets (see the Device entity: "Never exposed in any response DTO").
  // This is the tool-executor equivalent of a response DTO's @Expose()
  // allowlist, since raw repo results have no such filtering.
  private deviceView(scope: Scope, device: Device) {
    return {
      id: device.id,
      uniqueId: device.uniqueId,
      status: device.status,
      lastHeartbeatAt: device.lastHeartbeatAt,
      firmwareVersion: device.firmwareVersion,
      ...this.location(scope, device.coldRoomId),
    };
  }

  private alertView(
    scope: Scope,
    alert: Alert,
    deviceCodes: Map<string, string>,
  ) {
    return compact({
      id: alert.id,
      type: alert.type,
      status: alert.status,
      ...this.location(scope, alert.coldRoomId),
      device: alert.deviceId ? deviceCodes.get(alert.deviceId) : null,
      batchId: alert.batchId,
      triggerValue: alert.triggerValue,
      threshold: alert.threshold,
      createdAt: alert.createdAt,
      acknowledgedAt: alert.acknowledgedAt,
      resolvedAt: alert.resolvedAt,
      resolution: alert.resolution,
    });
  }

  private batchView(scope: Scope, batch: Batch) {
    return compact({
      id: batch.id,
      batchCode: batch.batchCode,
      productType: batch.productType?.name,
      unit: batch.productType?.unit,
      quantity: batch.quantity,
      status: batch.status,
      receivedAt: batch.receivedAt,
      expiryDate: batch.expiryDate,
      supplier: batch.supplier,
      ...this.location(scope, batch.coldRoomId),
    });
  }

  private async deviceCodes(ids: (string | null)[]) {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map<string, string>();
    const devices = await this.devicesRepo.find({
      where: { id: In(wanted) },
      select: { id: true, uniqueId: true },
    });
    return new Map(devices.map((d) => [d.id, d.uniqueId]));
  }

  // ---------------------------------------------------------------------
  // Tool handlers
  // ---------------------------------------------------------------------

  private async getAlerts(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const query: QueryAlertDto = {
      status: this.optionalString(args, 'status') as never,
      type: this.optionalString(args, 'type') as never,
      createdFrom: this.optionalDate(args, 'createdFrom'),
      createdTo: this.optionalDate(args, 'createdTo'),
      ...this.pagination(args),
    };
    const warehouseRef = this.optionalString(args, 'warehouseId');
    const roomRef = this.optionalString(args, 'coldRoomId');
    const deviceRef = this.optionalString(args, 'deviceId');
    const batchRef = this.optionalString(args, 'batchId');
    if (warehouseRef) {
      query.warehouseId = this.resolveWarehouse(scope, warehouseRef).id;
    }
    if (roomRef) {
      query.coldRoomId = this.resolveColdRoom(
        scope,
        roomRef,
        query.warehouseId,
      ).id;
    }
    if (deviceRef)
      query.deviceId = (await this.resolveDevice(scope, deviceRef)).id;
    if (batchRef) query.batchId = (await this.resolveBatch(scope, batchRef)).id;

    // One query filtered by warehouse (AlertsService joins cold_rooms),
    // instead of one findAll per cold room in the caller's warehouses.
    if (scope.assigned?.length === 0) return Paginated.empty(query);
    const page = await this.alertsService.findAll(
      query,
      scope.assigned === null
        ? undefined
        : {
            userId: caller.id,
            role: caller.role,
            warehouseIds: scope.assigned,
            staffWarehouseIds: this.getStaffWarehouseIds(caller),
          },
    );
    const codes = await this.deviceCodes(page.items.map((a) => a.deviceId));
    return {
      items: page.items.map((a) => this.alertView(scope, a, codes)),
      meta: page.meta,
    };
  }

  private async getAlertDetail(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const alertId = this.requireString(args, 'alertId');
    const alert = await this.alertsService.findOne(alertId); // throws NotFoundException itself
    const scope = await this.loadScope(caller);
    if (!scope.rooms.has(alert.coldRoomId)) {
      throw this.notFound('cảnh báo', alertId);
    }
    const codes = await this.deviceCodes([alert.deviceId]);
    return compact({
      ...this.alertView(scope, alert, codes),
      details: alert.details,
    });
  }

  private async getDevices(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const status = this.optionalString(args, 'status') as
      DeviceStatus | undefined;
    const filtered =
      !!this.optionalString(args, 'warehouseId') ||
      !!this.optionalString(args, 'coldRoomId');
    const rooms = this.roomsFor(scope, args);

    const where: FindOptionsWhere<Device> = {};
    if (status) where.status = status;
    // Admin with no location filter also sees devices not yet claimed.
    if (scope.assigned !== null || filtered) {
      if (rooms.length === 0) return listResult([], 0);
      where.coldRoomId = In(rooms.map((r) => r.id));
    }
    const [devices, total] = await this.devicesRepo.findAndCount({
      where,
      order: { uniqueId: 'ASC' },
      take: this.limit(args, 50, 200),
    });
    return listResult(
      devices.map((d) => this.deviceView(scope, d)),
      total,
    );
  }

  private async getDeviceDetail(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const device = await this.resolveDevice(
      scope,
      this.requireString(args, 'deviceId'),
    );
    return this.deviceView(scope, device);
  }

  private async getDeviceStatusHistory(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const device = await this.resolveDevice(
      scope,
      this.requireString(args, 'deviceId'),
    );
    return this.deviceStatusHistoryService.findAllForDevice(
      device.id,
      this.pagination(args),
    );
  }

  // One device (deviceId) or every device in a room (coldRoomId) — people
  // ask about rooms, and a room's sensors are its devices.
  private async getTelemetry(
    kind: 'hourly' | 'raw',
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const deviceRef = this.optionalString(args, 'deviceId');
    const roomRef = this.optionalString(args, 'coldRoomId');

    let devices: Device[];
    if (deviceRef) {
      devices = [await this.resolveDevice(scope, deviceRef)];
    } else if (roomRef) {
      const room = this.resolveColdRoom(scope, roomRef);
      devices = await this.devicesRepo.find({
        where: { coldRoomId: room.id },
        order: { uniqueId: 'ASC' },
        take: MAX_ROOM_TELEMETRY_DEVICES,
      });
      if (devices.length === 0) {
        throw new ChatbotToolError(
          `Phòng "${room.name}" chưa có thiết bị nào.`,
        );
      }
    } else {
      throw new ChatbotToolError('Cần truyền coldRoomId hoặc deviceId.');
    }

    const range = {
      from: this.optionalString(args, 'from'),
      to: this.optionalString(args, 'to'),
    };
    const limit = toInt(args.limit);
    const series = await Promise.all(
      devices.map(async (device) => ({
        device: device.uniqueId,
        ...this.location(scope, device.coldRoomId),
        readings: (kind === 'hourly'
          ? await this.telemetryService.findHourly(device.id, range)
          : await this.telemetryService.findRaw(device.id, { ...range, limit })
        ).map(stripTelemetryKeys),
      })),
    );
    return series;
  }

  private async getBatches(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const rooms = this.roomsFor(scope, args);
    if (rooms.length === 0) return listResult([], 0);

    const where: FindOptionsWhere<Batch> = {
      coldRoomId: In(rooms.map((r) => r.id)),
    };
    const status = this.optionalString(args, 'status') as
      BatchStatus | undefined;
    if (status) where.status = status;
    const withinDays = toInt(args.expiringWithinDays);
    if (withinDays !== undefined) {
      where.status = status ?? BatchStatus.IN_STOCK;
      where.expiryDate = LessThanOrEqual(businessDate(withinDays));
    }
    const [batches, total] = await this.batchesRepo.findAndCount({
      where,
      relations: { productType: true },
      order: { expiryDate: 'ASC', batchCode: 'ASC' },
      take: this.limit(args, 50, 200),
    });
    return listResult(
      batches.map((b) => this.batchView(scope, b)),
      total,
    );
  }

  private async getBatchDetail(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const batch = await this.resolveBatch(
      scope,
      this.requireString(args, 'batchId'),
    );
    return compact({
      ...this.batchView(scope, batch),
      removedAt: batch.removedAt,
      notes: batch.notes,
    });
  }

  private async getColdRooms(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const rooms = this.roomsFor(scope, args);
    return listResult(
      rooms.map((r) => this.roomView(scope, r)),
      rooms.length,
    );
  }

  private async getColdRoomDetail(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const room = this.resolveColdRoom(
      scope,
      this.requireString(args, 'coldRoomId'),
    );
    // Scope was checked by resolving the room within it.
    const [status] = await this.coldRoomStatus.findStatuses(
      { coldRoomIds: [room.id] },
      UNRESTRICTED_ACCESS(caller.id, caller.role),
    );
    return {
      ...this.roomView(scope, room),
      current: status
        ? {
            latest: status.latest && {
              ...status.latest,
              stale: isStale(status.latest.ts),
            },
            devices: status.devices,
            activeAlerts: status.activeAlerts,
            // Said outright so the model doesn't go digging through the
            // telemetry tools for a reading that isn't there.
            ...(status.latest
              ? {}
              : {
                  note:
                    status.devices.total > 0
                      ? 'Không có mẫu cảm biến nào gần đây cho phòng này (dữ liệu thô chỉ lưu ngắn hạn) — không có nhiệt độ hiện tại. Chỉ tra get_telemetry_hourly nếu người dùng cần lịch sử.'
                      : 'Phòng chưa có thiết bị giám sát nào.',
                }),
          }
        : null,
    };
  }

  private async getWarehouses(caller: ChatbotToolCaller) {
    const scope = await this.loadScope(caller);
    const roomCounts = new Map<string, number>();
    for (const room of scope.rooms.values()) {
      roomCounts.set(
        room.warehouseId,
        (roomCounts.get(room.warehouseId) ?? 0) + 1,
      );
    }
    const items = [...scope.warehouses.values()].map((w) =>
      compact({
        id: w.id,
        code: w.code,
        name: w.name,
        address: w.address,
        coldRooms: roomCounts.get(w.id) ?? 0,
      }),
    );
    return listResult(items, items.length);
  }

  private async getProductTypes() {
    // Not warehouse-scoped — shared reference data, same for every role.
    const types = await this.productTypesRepo.find({ order: { name: 'ASC' } });
    return types.map((t) =>
      compact({
        id: t.id,
        name: t.name,
        category: t.category,
        unit: t.unit,
        storageTempMin: t.storageTempMin,
        storageTempMax: t.storageTempMax,
      }),
    );
  }

  private async getCommands(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const status = this.optionalString(args, 'status') as never;
    const deviceRef = this.optionalString(args, 'deviceId');

    let deviceIds: string[] | undefined;
    if (deviceRef) {
      deviceIds = [(await this.resolveDevice(scope, deviceRef)).id];
    } else if (scope.assigned !== null) {
      if (scope.rooms.size === 0) return listResult([], 0);
      const devices = await this.devicesRepo.find({
        where: { coldRoomId: In([...scope.rooms.keys()]) },
        select: { id: true },
      });
      if (devices.length === 0) return listResult([], 0);
      deviceIds = devices.map((device) => device.id);
    }
    // deviceIds stays undefined only for Admin with no deviceId filter —
    // every other path above either sets it or returns early.

    const channels = await this.deviceChannelsRepo.find({
      where: deviceIds ? { deviceId: In(deviceIds) } : {},
    });
    if (channels.length === 0) return listResult([], 0);
    const channelsById = new Map(channels.map((c) => [c.id, c]));
    const [commands, total] = await this.commandsRepo.findAndCount({
      where: { channelId: In([...channelsById.keys()]), status },
      order: { createdAt: 'DESC' },
      take: this.limit(args, 20, 100),
    });
    const codes = await this.deviceCodes(
      commands.map((c) => channelsById.get(c.channelId)?.deviceId ?? null),
    );
    return listResult(
      commands.map((c) => {
        const channel = channelsById.get(c.channelId);
        return compact({
          id: c.id,
          action: c.action,
          status: c.status,
          device: channel ? codes.get(channel.deviceId) : null,
          channel: channel?.label ?? channel?.channelType,
          createdAt: c.createdAt,
          ackAt: c.ackAt,
        });
      }),
      total,
    );
  }

  private async getWorkShifts(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const warehouseRef = this.optionalString(args, 'warehouseId');
    const warehouseId = warehouseRef
      ? this.resolveWarehouse(scope, warehouseRef).id
      : undefined;
    const date = this.optionalDate(args, 'date');
    const requestedStaffId = this.optionalString(args, 'staffId');

    const base: FindOptionsWhere<WorkShift> = {};
    if (date) base.workDate = date;

    const where: FindOptionsWhere<WorkShift>[] = [];
    if (scope.assigned === null) {
      if (requestedStaffId) base.staffId = requestedStaffId;
      if (warehouseId) base.warehouseId = warehouseId;
      where.push(base);
    } else {
      // In warehouses where the caller acts as Staff they only ever see
      // their own shifts — the LLM-supplied staffId is ignored there, never
      // trusted.
      const staffSet = new Set(this.getStaffWarehouseIds(caller));
      const scoped = warehouseId ? [warehouseId] : scope.assigned;
      const otherIds = scoped.filter((id) => !staffSet.has(id));
      const staffIds = scoped.filter((id) => staffSet.has(id));
      if (otherIds.length > 0) {
        where.push({
          ...base,
          warehouseId: In(otherIds),
          ...(requestedStaffId ? { staffId: requestedStaffId } : {}),
        });
      }
      if (staffIds.length > 0) {
        where.push({ ...base, warehouseId: In(staffIds), staffId: caller.id });
      }
      if (where.length === 0) return listResult([], 0);
    }

    const [shifts, total] = await this.workShiftsRepo.findAndCount({
      where,
      relations: { staff: true, shift: true },
      order: { workDate: 'DESC', scheduledStartAt: 'DESC' },
      take: this.limit(args, 50, 200),
    });
    return listResult(
      shifts.map((s) =>
        compact({
          id: s.id,
          workDate: s.workDate,
          shift: s.shift?.name,
          staffId: s.staffId,
          staff: s.staff?.fullName ?? s.staff?.username,
          warehouse: this.warehouseCode(scope, s.warehouseId),
          status: s.status,
          scheduledStartAt: s.scheduledStartAt,
          scheduledEndAt: s.scheduledEndAt,
          checkInAt: s.checkInAt,
          checkOutAt: s.checkOutAt,
        }),
      ),
      total,
    );
  }

  // Everything "how are things?" needs in one call: live room status (one
  // Mongo aggregation + two grouped counts, via ColdRoomStatusService),
  // active alerts by type and the devices that need looking at.
  private async getSystemHealthSummary(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const scope = await this.loadScope(caller);
    const rooms = this.roomsFor(scope, args);
    // Counted from the scope, not the rooms: a warehouse may have none yet.
    const warehouses = this.optionalString(args, 'warehouseId')
      ? 1
      : scope.warehouses.size;
    const checkedAt = new Date();
    if (rooms.length === 0) {
      return { checkedAt, warehouses, coldRooms: 0 };
    }
    const roomIds = rooms.map((r) => r.id);

    const [statuses, alertsByType, problemDevices] = await Promise.all([
      // Scope was applied when choosing the rooms.
      this.coldRoomStatus.findStatuses(
        { coldRoomIds: roomIds },
        UNRESTRICTED_ACCESS(caller.id, caller.role),
      ),
      this.alertsRepo
        .createQueryBuilder('alert')
        .select('alert.type', 'type')
        .addSelect('COUNT(*)', 'count')
        .where('alert.coldRoomId IN (:...roomIds)', { roomIds })
        .andWhere('alert.status IN (:...statuses)', {
          statuses: ACTIVE_ALERT_STATUSES,
        })
        .groupBy('alert.type')
        .getRawMany<{ type: string; count: string }>(),
      this.devicesRepo.findAndCount({
        where: {
          coldRoomId: In(roomIds),
          status: In(PROBLEM_DEVICE_STATUSES),
        },
        order: { lastHeartbeatAt: 'ASC' },
        take: MAX_SUMMARY_ITEMS,
      }),
    ]);

    const devicesByStatus: Record<string, number> = {};
    let deviceTotal = 0;
    const attention: {
      coldRoom: string;
      warehouse: string | null;
      temperature: number | null;
      reasons: string[];
    }[] = [];
    for (const status of statuses) {
      const room = scope.rooms.get(status.coldRoomId);
      if (!room) continue;
      const { total, ...byStatus } = status.devices;
      deviceTotal += total;
      for (const [key, count] of Object.entries(byStatus)) {
        devicesByStatus[key] = (devicesByStatus[key] ?? 0) + (count ?? 0);
      }
      const reasons = roomProblems(room, status.latest, status.devices, {
        activeAlerts: status.activeAlerts,
        now: checkedAt,
      });
      if (reasons.length > 0) {
        attention.push({
          coldRoom: room.name,
          warehouse: this.warehouseCode(scope, room.warehouseId),
          temperature: status.latest?.temperature ?? null,
          reasons,
        });
      }
    }

    const byType = Object.fromEntries(
      alertsByType.map((row) => [row.type, Number(row.count)]),
    );
    const [devices, problemTotal] = problemDevices;
    return {
      checkedAt,
      warehouses,
      coldRooms: rooms.length,
      devices: { total: deviceTotal, byStatus: devicesByStatus },
      activeAlerts: {
        total: Object.values(byType).reduce((sum, n) => sum + n, 0),
        byType,
      },
      roomsNeedingAttention: listResult(
        attention.slice(0, MAX_SUMMARY_ITEMS),
        attention.length,
      ),
      roomsOk: rooms.length - attention.length,
      problemDevices: listResult(
        devices.map((d) => this.deviceView(scope, d)),
        problemTotal,
      ),
    };
  }

  // Not warehouse-scoped — the 3 whitelisted docs are business-wide
  // content, same for every role that can reach this tool.
  private searchDocs(args: Record<string, unknown>) {
    const query = this.requireString(args, 'query');
    return searchChatbotDocs(query);
  }
}

function toInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : undefined;
}

// A capped list with how many rows matched, so the model knows when it only
// sees part of the answer (and can narrow the filter or raise `limit`).
function listResult<T>(items: T[], total: number) {
  return items.length < total
    ? {
        total,
        returned: items.length,
        items,
        note: `Chỉ trả về ${items.length}/${total} bản ghi — thu hẹp bộ lọc hoặc tăng limit nếu cần.`,
      }
    : { total, items };
}

// Drops null/undefined fields: an empty column costs tokens and says nothing.
function compact<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(row).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  ) as Partial<T>;
}

// Mongo bookkeeping and ids the caller already knows (the device is named
// alongside the readings).
const TELEMETRY_OMIT = new Set(['_id', '__v', 'deviceId', 'coldRoomId']);

function stripTelemetryKeys(doc: object) {
  return Object.fromEntries(
    Object.entries(doc).filter(([key]) => !TELEMETRY_OMIT.has(key)),
  );
}

function isStale(ts: Date, now = new Date()) {
  return now.getTime() - new Date(ts).getTime() > STALE_AFTER_MS;
}

// Why a room needs a look right now, in words the model can repeat.
function roomProblems(
  room: ColdRoom,
  latest: {
    ts: Date;
    temperature: number | null;
    doorOpen: boolean;
    sensorFault: boolean;
    outOfRange: boolean;
  } | null,
  devices: { total: number } & Partial<Record<DeviceStatus, number>>,
  extra: { activeAlerts: number; now: Date },
): string[] {
  const reasons: string[] = [];
  if (!latest) {
    if (devices.total > 0) reasons.push('chưa nhận được dữ liệu cảm biến');
  } else if (isStale(latest.ts, extra.now)) {
    const minutes = Math.round(
      (extra.now.getTime() - new Date(latest.ts).getTime()) / 60_000,
    );
    reasons.push(`mất tín hiệu ${minutes} phút`);
  } else {
    if (latest.outOfRange && latest.temperature !== null) {
      reasons.push(
        `nhiệt độ ${latest.temperature}°C ngoài ngưỡng ${room.tempMin}..${room.tempMax}°C`,
      );
    }
    if (latest.sensorFault) reasons.push('lỗi cảm biến');
    if (latest.doorOpen) reasons.push('cửa đang mở');
  }
  const broken = PROBLEM_DEVICE_STATUSES.reduce(
    (sum, status) => sum + (devices[status] ?? 0),
    0,
  );
  if (broken > 0) reasons.push(`${broken} thiết bị offline/lỗi/bảo trì`);
  if (extra.activeAlerts > 0) {
    reasons.push(`${extra.activeAlerts} cảnh báo chưa xử lý`);
  }
  return reasons;
}

// "YYYY-MM-DD" `days` from today, in the business timezone (en-CA formats
// dates that way).
function businessDate(days: number, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CHATBOT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now.getTime() + days * 86_400_000));
}

// Accent/case-insensitive, so "phong a1" finds "Phòng A1 – Cấp đông".
function fold(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Best match by name/code: exact, else prefix, else substring — the first
// tier with any hit decides. Several hits in it is an error listing them,
// so the model asks the user (or retries) instead of guessing.
function pickByName<T>(
  items: T[],
  ref: string,
  names: (item: T) => string[],
  label: (item: T) => string,
  kind: string,
  notFound: () => Error,
  // Among several equally good matches, one this accepts wins (e.g. the
  // room in the warehouse the user is working in).
  preferred?: (item: T) => boolean,
): T {
  const needle = fold(ref);
  const folded = items.map((item) => ({ item, names: names(item).map(fold) }));
  const words = needle.split(' ').filter(Boolean);
  const tiers = [
    (name: string) => name === needle,
    (name: string) => name.startsWith(needle),
    (name: string) => name.includes(needle),
    // Every word said, in any order and with others between: "phòng rau
    // quả" → "Phòng B4 – Rau quả & trứng".
    (name: string) => {
      const nameWords = name.split(' ');
      return words.every((word) => nameWords.includes(word));
    },
  ];
  for (const test of tiers) {
    const hits = folded.filter((f) => f.names.some(test)).map((f) => f.item);
    if (hits.length === 1) return hits[0];
    const favoured = preferred ? hits.filter(preferred) : [];
    if (favoured.length === 1) return favoured[0];
    if (hits.length > 1) {
      const shown = hits.slice(0, MAX_AMBIGUOUS).map(label).join('; ');
      throw new ChatbotToolError(
        `Có ${hits.length} ${kind} khớp "${ref}": ${shown}${hits.length > MAX_AMBIGUOUS ? '; …' : ''}. Hãy hỏi lại người dùng hoặc dùng tên đầy đủ.`,
      );
    }
  }
  throw notFound();
}
