import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserRole } from '../../../libs/constants/user.constant';
import { AlertsService } from '../../alerts/alerts.service';
import { Batch } from '../../batches/entities/batch.entity';
import { ColdRoom } from '../../cold-rooms/entities/cold-room.entity';
import { Command } from '../../commands/entities/command.entity';
import { DeviceChannel } from '../../device-channels/entities/device-channel.entity';
import { DeviceStatusHistoryService } from '../../device-status-history/device-status-history.service';
import { Device } from '../../devices/entities/device.entity';
import { ProductType } from '../../product-types/entities/product-type.entity';
import { TelemetryService } from '../../telemetry/telemetry.service';
import { Warehouse } from '../../warehouses/entities/warehouse.entity';
import { WarehouseStaff } from '../../warehouses/entities/warehouse-staff.entity';
import { WorkShift } from '../../work-shifts/entities/work-shift.entity';
import { searchChatbotDocs } from './chatbot-docs-search';
import { CHATBOT_TOOLS } from './chatbot-tools.definitions';

export interface ChatbotToolCaller {
  id: string;
  role: UserRole;
}

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
  'get_system_health_summary',
  'get_inventory_summary',
  'get_staff_performance_summary',
  'get_previous_shift_summary',
]);

// Executes a tool call the LLM asked for, after enforcing the
// allowedRoles/scope declared on it in chatbot-tools.definitions.ts.
//
// Deliberately injects repositories directly for the simple entities
// (Device, Batch, ColdRoom, Warehouse, ProductType, Command, DeviceChannel,
// WorkShift, WarehouseStaff) rather than the modules' own services — those
// modules don't export their services (only AlertsModule/TelemetryModule/
// DeviceStatusHistoryModule do), and this matches the existing convention
// of cross-module reads going straight through repositories (see
// NotificationsService, which does the same for ColdRoom/WarehouseStaff).
// This also means scope-filtered queries (e.g. "every cold room in the
// caller's warehouses") can be a single `In(...)` query instead of one
// service call per id.
//
// Guards (JwtAuthGuard/RolesGuard/WarehouseScopeGuard) never run here —
// they only fire on the HTTP pipeline (see RbacModule) — so every branch
// below re-derives and checks scope itself before touching data, matching
// the design discussed for this module: never trust an id the LLM supplied
// without verifying it resolves to a warehouse the caller is assigned to.
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
    @InjectRepository(WarehouseStaff)
    private readonly warehouseStaffRepo: Repository<WarehouseStaff>,
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
    if (!def.allowedRoles.includes(caller.role)) {
      return { error: 'Bạn không có quyền sử dụng chức năng này.' };
    }
    if (CHATBOT_TOOLS_NOT_IMPLEMENTED.has(name)) {
      return {
        error: `Chức năng "${name}" chưa được triển khai ở phiên bản hiện tại.`,
      };
    }

    try {
      const result = await this.dispatch(name, args, caller);
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
        return this.getTelemetryHourly(args, caller);
      case 'get_telemetry_raw':
        return this.getTelemetryRaw(args, caller);
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
      case 'search_docs':
        return this.searchDocs(args);
      default:
        throw new ChatbotToolError(`Tool "${name}" chưa có handler thực thi.`);
    }
  }

  // ---------------------------------------------------------------------
  // Scope helpers
  // ---------------------------------------------------------------------

  // null = unrestricted (Admin). Never null and empty at once — empty means
  // "authenticated, zero warehouse assignments", which is a real state for
  // a freshly created Manager/Staff account.
  private async getAssignedWarehouseIds(
    caller: ChatbotToolCaller,
  ): Promise<string[] | null> {
    if (caller.role === UserRole.ADMIN) return null;
    const rows = await this.warehouseStaffRepo.find({
      where: { userId: caller.id },
    });
    return rows.map((row) => row.warehouseId);
  }

  private isWarehouseAllowed(
    assigned: string[] | null,
    warehouseId: string,
  ): boolean {
    return assigned === null || assigned.includes(warehouseId);
  }

  private async getColdRoomIdsForWarehouses(
    warehouseIds: string[],
  ): Promise<string[]> {
    if (warehouseIds.length === 0) return [];
    const rooms = await this.coldRoomsRepo.find({
      where: { warehouseId: In(warehouseIds) },
    });
    return rooms.map((room) => room.id);
  }

  private async warehouseIdOfColdRoom(
    coldRoomId: string,
  ): Promise<string | null> {
    const room = await this.coldRoomsRepo.findOne({
      where: { id: coldRoomId },
    });
    return room?.warehouseId ?? null;
  }

  private async warehouseIdOfDevice(deviceId: string): Promise<string | null> {
    const device = await this.devicesRepo.findOne({ where: { id: deviceId } });
    if (!device?.coldRoomId) return null;
    return this.warehouseIdOfColdRoom(device.coldRoomId);
  }

  private async warehouseIdOfBatch(batchId: string): Promise<string | null> {
    const batch = await this.batchesRepo.findOne({ where: { id: batchId } });
    if (!batch) return null;
    return this.warehouseIdOfColdRoom(batch.coldRoomId);
  }

  // Throws unless the resolved warehouse is null-safe-checked AND allowed —
  // the two failure modes (resource doesn't exist / resource not in scope)
  // deliberately return the same generic message, same reasoning as
  // NotificationsService.markRead not distinguishing "not found" from
  // "belongs to someone else".
  private assertAllowedOrThrow(
    assigned: string[] | null,
    warehouseId: string | null,
  ): void {
    if (!warehouseId || !this.isWarehouseAllowed(assigned, warehouseId)) {
      throw new ChatbotToolError(
        'Bạn không có quyền truy cập tài nguyên này hoặc tài nguyên không tồn tại.',
      );
    }
  }

  private requireString(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new ChatbotToolError(`Thiếu tham số bắt buộc "${key}".`);
    }
    return value;
  }

  private optionalString(
    args: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = args[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  // ---------------------------------------------------------------------
  // Tool handlers
  // ---------------------------------------------------------------------

  private async getAlerts(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const assigned = await this.getAssignedWarehouseIds(caller);
    const coldRoomId = this.optionalString(args, 'coldRoomId');
    const baseQuery = {
      status: this.optionalString(args, 'status') as never,
      type: this.optionalString(args, 'type') as never,
      deviceId: this.optionalString(args, 'deviceId'),
      batchId: this.optionalString(args, 'batchId'),
    };

    if (coldRoomId) {
      const warehouseId = await this.warehouseIdOfColdRoom(coldRoomId);
      this.assertAllowedOrThrow(assigned, warehouseId);
      return this.alertsService.findAll({ ...baseQuery, coldRoomId });
    }

    if (assigned === null) {
      return this.alertsService.findAll(baseQuery);
    }
    const coldRoomIds = await this.getColdRoomIdsForWarehouses(assigned);
    if (coldRoomIds.length === 0) return [];
    const perRoom = await Promise.all(
      coldRoomIds.map((id) =>
        this.alertsService.findAll({ ...baseQuery, coldRoomId: id }),
      ),
    );
    return perRoom
      .flat()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private async getAlertDetail(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const alertId = this.requireString(args, 'alertId');
    const alert = await this.alertsService.findOne(alertId); // throws NotFoundException itself
    const assigned = await this.getAssignedWarehouseIds(caller);
    const warehouseId = await this.warehouseIdOfColdRoom(alert.coldRoomId);
    this.assertAllowedOrThrow(assigned, warehouseId);
    return alert;
  }

  private async getDevices(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const assigned = await this.getAssignedWarehouseIds(caller);
    const coldRoomId = this.optionalString(args, 'coldRoomId');

    if (coldRoomId) {
      const warehouseId = await this.warehouseIdOfColdRoom(coldRoomId);
      this.assertAllowedOrThrow(assigned, warehouseId);
      const devices = await this.devicesRepo.find({ where: { coldRoomId } });
      return devices.map(sanitizeDevice);
    }

    if (assigned === null) {
      return (await this.devicesRepo.find()).map(sanitizeDevice);
    }
    const coldRoomIds = await this.getColdRoomIdsForWarehouses(assigned);
    if (coldRoomIds.length === 0) return [];
    const devices = await this.devicesRepo.find({
      where: { coldRoomId: In(coldRoomIds) },
    });
    return devices.map(sanitizeDevice);
  }

  private async getDeviceDetail(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const deviceId = this.requireString(args, 'deviceId');
    const assigned = await this.getAssignedWarehouseIds(caller);
    const warehouseId = await this.warehouseIdOfDevice(deviceId);
    this.assertAllowedOrThrow(assigned, warehouseId);
    const device = await this.devicesRepo.findOne({ where: { id: deviceId } });
    if (!device)
      throw new ChatbotToolError(`Device ${deviceId} không tồn tại.`);
    return sanitizeDevice(device);
  }

  private async getDeviceStatusHistory(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const deviceId = this.requireString(args, 'deviceId');
    const assigned = await this.getAssignedWarehouseIds(caller);
    const warehouseId = await this.warehouseIdOfDevice(deviceId);
    this.assertAllowedOrThrow(assigned, warehouseId);
    return this.deviceStatusHistoryService.findAllForDevice(deviceId);
  }

  private async getTelemetryHourly(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const deviceId = this.requireString(args, 'deviceId');
    const assigned = await this.getAssignedWarehouseIds(caller);
    const warehouseId = await this.warehouseIdOfDevice(deviceId);
    this.assertAllowedOrThrow(assigned, warehouseId);
    return this.telemetryService.findHourly(deviceId, {
      from: this.optionalString(args, 'from'),
      to: this.optionalString(args, 'to'),
    });
  }

  private async getTelemetryRaw(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const deviceId = this.requireString(args, 'deviceId');
    const assigned = await this.getAssignedWarehouseIds(caller);
    const warehouseId = await this.warehouseIdOfDevice(deviceId);
    this.assertAllowedOrThrow(assigned, warehouseId);
    const limit = args.limit;
    return this.telemetryService.findRaw(deviceId, {
      from: this.optionalString(args, 'from'),
      to: this.optionalString(args, 'to'),
      limit: typeof limit === 'number' ? limit : undefined,
    });
  }

  private async getBatches(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const assigned = await this.getAssignedWarehouseIds(caller);
    const coldRoomId = this.optionalString(args, 'coldRoomId');
    const status = this.optionalString(args, 'status') as never;

    if (coldRoomId) {
      const warehouseId = await this.warehouseIdOfColdRoom(coldRoomId);
      this.assertAllowedOrThrow(assigned, warehouseId);
      return this.batchesRepo.find({ where: { coldRoomId, status } });
    }

    if (assigned === null) {
      return this.batchesRepo.find({ where: { status } });
    }
    const coldRoomIds = await this.getColdRoomIdsForWarehouses(assigned);
    if (coldRoomIds.length === 0) return [];
    return this.batchesRepo.find({
      where: { coldRoomId: In(coldRoomIds), status },
    });
  }

  private async getBatchDetail(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const batchId = this.requireString(args, 'batchId');
    const assigned = await this.getAssignedWarehouseIds(caller);
    const warehouseId = await this.warehouseIdOfBatch(batchId);
    this.assertAllowedOrThrow(assigned, warehouseId);
    return this.batchesRepo.findOne({ where: { id: batchId } });
  }

  private async getColdRooms(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const assigned = await this.getAssignedWarehouseIds(caller);
    const warehouseId = this.optionalString(args, 'warehouseId');

    if (warehouseId) {
      this.assertAllowedOrThrow(assigned, warehouseId);
      return this.coldRoomsRepo.find({ where: { warehouseId } });
    }
    if (assigned === null) return this.coldRoomsRepo.find();
    if (assigned.length === 0) return [];
    return this.coldRoomsRepo.find({ where: { warehouseId: In(assigned) } });
  }

  private async getColdRoomDetail(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const coldRoomId = this.requireString(args, 'coldRoomId');
    const room = await this.coldRoomsRepo.findOne({
      where: { id: coldRoomId },
    });
    const assigned = await this.getAssignedWarehouseIds(caller);
    this.assertAllowedOrThrow(assigned, room?.warehouseId ?? null);
    return room;
  }

  private async getWarehouses(caller: ChatbotToolCaller) {
    const assigned = await this.getAssignedWarehouseIds(caller);
    if (assigned === null) return this.warehousesRepo.find();
    if (assigned.length === 0) return [];
    return this.warehousesRepo.find({ where: { id: In(assigned) } });
  }

  private getProductTypes() {
    // Not warehouse-scoped — shared reference data, same for every role.
    return this.productTypesRepo.find();
  }

  private async getCommands(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const assigned = await this.getAssignedWarehouseIds(caller);
    const status = this.optionalString(args, 'status') as never;
    const deviceId = this.optionalString(args, 'deviceId');

    let deviceIds: string[] | undefined;
    if (deviceId) {
      const warehouseId = await this.warehouseIdOfDevice(deviceId);
      this.assertAllowedOrThrow(assigned, warehouseId);
      deviceIds = [deviceId];
    } else if (assigned !== null) {
      const coldRoomIds = await this.getColdRoomIdsForWarehouses(assigned);
      if (coldRoomIds.length === 0) return [];
      const devices = await this.devicesRepo.find({
        where: { coldRoomId: In(coldRoomIds) },
      });
      if (devices.length === 0) return [];
      deviceIds = devices.map((device) => device.id);
    }
    // deviceIds stays undefined only for Admin with no deviceId filter —
    // every other path above either sets it or returns early.

    const channels = await this.deviceChannelsRepo.find({
      where: deviceIds ? { deviceId: In(deviceIds) } : {},
    });
    if (channels.length === 0) return [];
    return this.commandsRepo.find({
      where: {
        channelId: In(channels.map((channel) => channel.id)),
        status,
      },
      order: { createdAt: 'DESC' },
    });
  }

  private async getWorkShifts(
    args: Record<string, unknown>,
    caller: ChatbotToolCaller,
  ) {
    const assigned = await this.getAssignedWarehouseIds(caller);
    const warehouseId = this.optionalString(args, 'warehouseId');
    const date = this.optionalString(args, 'date');
    // Staff can only ever see their own shifts through the chatbot — the
    // LLM-supplied staffId (if any) is ignored for that role, never trusted.
    const staffId =
      caller.role === UserRole.STAFF
        ? caller.id
        : this.optionalString(args, 'staffId');

    const where: Record<string, unknown> = {};
    if (staffId) where.staffId = staffId;
    if (date) where.workDate = date;

    if (warehouseId) {
      this.assertAllowedOrThrow(assigned, warehouseId);
      return this.workShiftsRepo.find({
        where: { ...where, warehouseId },
        order: { workDate: 'DESC' },
      });
    }
    if (assigned === null) {
      return this.workShiftsRepo.find({ where, order: { workDate: 'DESC' } });
    }
    if (assigned.length === 0) return [];
    return this.workShiftsRepo.find({
      where: { ...where, warehouseId: In(assigned) },
      order: { workDate: 'DESC' },
    });
  }

  // Not warehouse-scoped — the 3 whitelisted docs are business-wide
  // content, same for every role that can reach this tool.
  private searchDocs(args: Record<string, unknown>) {
    const query = this.requireString(args, 'query');
    return searchChatbotDocs(query);
  }
}

// Never send claim_code_hash/claim_code_expires_at to the LLM — these are
// activation secrets (see Device entity's own comment: "Never exposed in
// any response DTO"). This is the tool-executor equivalent of a response
// DTO's @Expose() allowlist, since raw repo results have no such filtering.
function sanitizeDevice(device: Device) {
  return {
    id: device.id,
    uniqueId: device.uniqueId,
    coldRoomId: device.coldRoomId,
    firmwareVersion: device.firmwareVersion,
    status: device.status,
    lastHeartbeatAt: device.lastHeartbeatAt,
  };
}
