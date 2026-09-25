import { api } from './client'
import type {
  Alert,
  AlertStatus,
  AlertType,
  AppNotification,
  AuditLog,
  Batch,
  BulkDeleteResult,
  BatchStatus,
  ColdRoom,
  ColdRoomSeries,
  ColdRoomStatus,
  Command,
  CommandAction,
  CommandStatus,
  Device,
  DeviceChannel,
  DeviceStatus,
  PageQuery,
  Paginated,
  ProductType,
  ProductUnit,
  Shift,
  TelemetryRange,
  User,
  UserRole,
  UserStatus,
  Warehouse,
  WarehouseStaff,
  WorkShift,
  WorkShiftStatus,
} from './types'

// List filters follow the backend's shared conventions (docs/API_DESIGN.md §1):
// `search` matches any of the endpoint's text fields, date bounds are
// YYYY-MM-DD and inclusive, and a warehouseId outside the caller's scope just
// yields an empty page.

/** Backend flags are the literal strings "true"/"false". */
const flag = (v: boolean | undefined) => (v === undefined ? undefined : String(v))

interface SearchQuery extends PageQuery {
  search?: string
}

interface CreatedRangeQuery {
  /** Compared as UTC days. */
  createdFrom?: string
  createdTo?: string
}

export const authApi = {
  login: (body: { username: string; password: string }) =>
    api.post<User>('/auth/login', body, { skipRefresh: true }),
  logout: () => api.post<null>('/auth/logout', undefined, { skipRefresh: true }),
  me: () => api.get<User>('/auth/me'),
}

export interface WarehouseQuery extends SearchQuery, CreatedRangeQuery {
  hasAddress?: boolean
}

export interface CreateWarehouseBody {
  name: string
  code: string
  address?: string
}

/** PATCH body: omitted = unchanged, null = cleared. */
export interface UpdateWarehouseBody {
  name?: string
  code?: string
  address?: string | null
}

export const warehousesApi = {
  list: (q: WarehouseQuery = {}) =>
    api.get<Paginated<Warehouse>>('/warehouses', { ...q, hasAddress: flag(q.hasAddress) }),
  get: (id: string) => api.get<Warehouse>(`/warehouses/${id}`),
  create: (body: CreateWarehouseBody) => api.post<Warehouse>('/warehouses', body),
  update: (id: string, body: UpdateWarehouseBody) => api.patch<Warehouse>(`/warehouses/${id}`, body),
  /** Soft delete; also removes its cold rooms and staff assignments. */
  remove: (id: string) => api.delete<null>(`/warehouses/${id}`),
  /** Up to 100 ids; see docs/API_DESIGN.md. */
  bulkRemove: (ids: string[]) => api.post<BulkDeleteResult>('/warehouses/bulk-delete', { ids }),
  /** Admin, or Manager of that warehouse. */
  staff: (warehouseId: string, q: PageQuery = {}) =>
    api.get<Paginated<WarehouseStaff>>(`/warehouses/${warehouseId}/staff`, { ...q }),
}

export interface ColdRoomQuery extends SearchQuery, CreatedRangeQuery {
  warehouseId?: string
}

export interface CreateColdRoomBody {
  warehouseId: string
  name: string
  tempMin: number
  tempMax: number
  hysteresis?: number
  doorOpenMaxSeconds?: number
  capacityPallets?: number
  capacityWeightKg?: number
  capacityVolumeM3?: number
}

/** warehouseId is immutable; the capacity fields accept null to clear. */
export interface UpdateColdRoomBody {
  name?: string
  tempMin?: number
  tempMax?: number
  hysteresis?: number
  doorOpenMaxSeconds?: number
  capacityPallets?: number | null
  capacityWeightKg?: number | null
  capacityVolumeM3?: number | null
}

export const coldRoomsApi = {
  list: (q: ColdRoomQuery = {}) => api.get<Paginated<ColdRoom>>('/cold-rooms', { ...q }),
  create: (body: CreateColdRoomBody) => api.post<ColdRoom>('/cold-rooms', body),
  update: (id: string, body: UpdateColdRoomBody) => api.patch<ColdRoom>(`/cold-rooms/${id}`, body),
  remove: (id: string) => api.delete<null>(`/cold-rooms/${id}`),
  /**
   * Latest reading + device/alert counts for the given rooms, or for every
   * room of the given warehouses (≤ 100 ids each). Rooms outside the
   * caller's scope — or, for Staff, without an active shift — are left out.
   */
  /** Temperature history for the monitoring chart; anyone assigned to the warehouse. */
  telemetry: (id: string, range: TelemetryRange) =>
    api.get<ColdRoomSeries>(`/cold-rooms/${id}/telemetry`, { range }),
  status: (q: { coldRoomIds?: string[]; warehouseIds?: string[] }) =>
    api.get<ColdRoomStatus[]>('/cold-rooms/status', {
      coldRoomIds: q.coldRoomIds?.join(','),
      warehouseIds: q.warehouseIds?.join(','),
    }),
  /** Up to 100 ids; see docs/API_DESIGN.md. */
  bulkRemove: (ids: string[]) => api.post<BulkDeleteResult>('/cold-rooms/bulk-delete', { ids }),
}

export interface DeviceQuery extends SearchQuery {
  status?: DeviceStatus
  warehouseId?: string
  coldRoomId?: string
  /** Not claimed into any cold room — only Admin can see those. */
  unassigned?: boolean
}

export interface CreateDeviceBody {
  uniqueId: string
  firmwareVersion?: string
}

/** uniqueId is immutable; room/status change through claim/decommission. */
export interface UpdateDeviceBody {
  firmwareVersion?: string | null
}

export const devicesApi = {
  list: (q: DeviceQuery = {}) =>
    api.get<Paginated<Device>>('/devices', { ...q, unassigned: flag(q.unassigned) }),
  create: (body: CreateDeviceBody) => api.post<Device>('/devices', body),
  update: (id: string, body: UpdateDeviceBody) => api.patch<Device>(`/devices/${id}`, body),
  remove: (id: string) => api.delete<null>(`/devices/${id}`),
  /** Up to 100 ids; see docs/API_DESIGN.md. */
  bulkRemove: (ids: string[]) => api.post<BulkDeleteResult>('/devices/bulk-delete', { ids }),
  /** Not paginated — a device has a handful of channels. Staff may not call it. */
  channels: (deviceId: string) => api.get<DeviceChannel[]>(`/devices/${deviceId}/channels`),
}

export interface CommandQuery extends PageQuery, CreatedRangeQuery {
  status?: CommandStatus
  action?: CommandAction
  warehouseId?: string
  deviceId?: string
  channelId?: string
  issuedBy?: string
}

export interface CreateCommandBody {
  channelId: string
  action: CommandAction
}

export const commandsApi = {
  list: (q: CommandQuery = {}) => api.get<Paginated<Command>>('/commands', { ...q }),
  /** The issuer is always the caller; the backend never takes it from the body. */
  create: (body: CreateCommandBody) => api.post<Command>('/commands', body),
}

export interface ProductTypeQuery extends SearchQuery {
  unit?: ProductUnit
}

export interface CreateProductTypeBody {
  name: string
  category?: string
  unit: ProductUnit
  storageTempMin?: number
  storageTempMax?: number
}

export interface UpdateProductTypeBody {
  name?: string
  category?: string | null
  unit?: ProductUnit
  storageTempMin?: number | null
  storageTempMax?: number | null
}

export const productTypesApi = {
  list: (q: ProductTypeQuery = {}) =>
    api.get<Paginated<ProductType>>('/product-types', { ...q }),
  create: (body: CreateProductTypeBody) => api.post<ProductType>('/product-types', body),
  update: (id: string, body: UpdateProductTypeBody) =>
    api.patch<ProductType>(`/product-types/${id}`, body),
  remove: (id: string) => api.delete<null>(`/product-types/${id}`),
  /** Up to 100 ids; see docs/API_DESIGN.md. */
  bulkRemove: (ids: string[]) => api.post<BulkDeleteResult>('/product-types/bulk-delete', { ids }),
}

export const shiftsApi = {
  list: (q: PageQuery = {}) => api.get<Paginated<Shift>>('/shifts', { ...q }),
}

export interface BatchQuery extends SearchQuery {
  status?: BatchStatus
  warehouseId?: string
  coldRoomId?: string
  productTypeId?: string
  expiryFrom?: string
  expiryTo?: string
  receivedFrom?: string
  receivedTo?: string
}

export interface CreateBatchBody {
  coldRoomId: string
  productTypeId: string
  batchCode: string
  quantity: number
  supplier?: string
  /** YYYY-MM-DD */
  receivedAt: string
  /** YYYY-MM-DD, strictly after receivedAt. */
  expiryDate: string
  notes?: string
}

/** coldRoomId is immutable; status changes only through remove. */
export interface UpdateBatchBody {
  productTypeId?: string
  batchCode?: string
  quantity?: number
  supplier?: string | null
  receivedAt?: string
  expiryDate?: string
  notes?: string | null
}

export const batchesApi = {
  list: (q: BatchQuery = {}) => api.get<Paginated<Batch>>('/batches', { ...q }),
  create: (body: CreateBatchBody) => api.post<Batch>('/batches', body),
  update: (id: string, body: UpdateBatchBody) => api.patch<Batch>(`/batches/${id}`, body),
  /** Not a delete: marks the batch `removed` (taken out of storage); 409 if it already is. */
  remove: (id: string) => api.delete<unknown>(`/batches/${id}`),
  /** Up to 100 ids; see docs/API_DESIGN.md. */
  bulkRemove: (ids: string[]) => api.post<BulkDeleteResult>('/batches/bulk-delete', { ids }),
}

export interface WorkShiftQuery extends PageQuery {
  status?: WorkShiftStatus
  warehouseId?: string
  shiftId?: string
  staffId?: string
  workDateFrom?: string
  workDateTo?: string
}

export interface CreateWorkShiftBody {
  shiftId: string
  staffId: string
  warehouseId: string
  /** YYYY-MM-DD */
  workDate: string
}

/** warehouseId is immutable; the schedule is recomputed from shiftId + workDate. */
export interface UpdateWorkShiftBody {
  shiftId?: string
  staffId?: string
  /** YYYY-MM-DD */
  workDate?: string
}

export const workShiftsApi = {
  list: (q: WorkShiftQuery = {}) => api.get<Paginated<WorkShift>>('/work-shifts', { ...q }),
  create: (body: CreateWorkShiftBody) => api.post<WorkShift>('/work-shifts', body),
  update: (id: string, body: UpdateWorkShiftBody) => api.patch<WorkShift>(`/work-shifts/${id}`, body),
  remove: (id: string) => api.delete<null>(`/work-shifts/${id}`),
  /** Up to 100 ids; see docs/API_DESIGN.md. */
  bulkRemove: (ids: string[]) => api.post<BulkDeleteResult>('/work-shifts/bulk-delete', { ids }),
}

export interface AlertQuery extends PageQuery, CreatedRangeQuery {
  status?: AlertStatus
  type?: AlertType
  warehouseId?: string
  coldRoomId?: string
  deviceId?: string
  batchId?: string
}

export const alertsApi = {
  list: (q: AlertQuery = {}) => api.get<Paginated<Alert>>('/alerts', { ...q }),
  acknowledge: (id: string) => api.post<Alert>(`/alerts/${id}/acknowledge`),
  resolve: (id: string) => api.post<Alert>(`/alerts/${id}/resolve`),
}

export interface NotificationQuery extends SearchQuery, CreatedRangeQuery {
  unreadOnly?: boolean
}

export const notificationsApi = {
  list: (q: NotificationQuery = {}) =>
    api.get<Paginated<AppNotification>>('/notifications', {
      ...q,
      unreadOnly: flag(q.unreadOnly),
    }),
  markRead: (id: string) => api.post<AppNotification>(`/notifications/${id}/read`),
}

export interface AuditLogQuery extends PageQuery, CreatedRangeQuery {
  userId?: string
  warehouseId?: string
  targetType?: string
  targetId?: string
  /** Exact action name, e.g. "warehouse.update". */
  action?: string
}

export const auditLogsApi = {
  list: (q: AuditLogQuery = {}) => api.get<Paginated<AuditLog>>('/audit-logs', { ...q }),
}

export interface UserQuery extends SearchQuery {
  role?: UserRole
  status?: UserStatus
}

export interface CreateUserBody {
  username: string
  password: string
  role: UserRole
  fullName?: string
  email?: string
  phone?: string
}

/** No password here; only an admin may change `role`. */
export interface UpdateUserBody {
  username?: string
  role?: UserRole
  fullName?: string | null
  email?: string | null
  phone?: string | null
}

export const usersApi = {
  list: (q: UserQuery = {}) => api.get<Paginated<User>>('/users', { ...q }),
  create: (body: CreateUserBody) => api.post<User>('/users', body),
  update: (id: string, body: UpdateUserBody) => api.patch<User>(`/users/${id}`, body),
  /** Soft delete; also drops the user's warehouse assignments. */
  remove: (id: string) => api.delete<null>(`/users/${id}`),
  /** Up to 100 ids; see docs/API_DESIGN.md. */
  bulkRemove: (ids: string[]) => api.post<BulkDeleteResult>('/users/bulk-delete', { ids }),
}
