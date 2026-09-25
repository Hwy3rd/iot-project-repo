import { api } from './client'
import type {
  Alert,
  AlertStatus,
  AlertType,
  AppNotification,
  AuditLog,
  Batch,
  BatchStatus,
  ColdRoom,
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

export const warehousesApi = {
  list: (q: WarehouseQuery = {}) =>
    api.get<Paginated<Warehouse>>('/warehouses', { ...q, hasAddress: flag(q.hasAddress) }),
  get: (id: string) => api.get<Warehouse>(`/warehouses/${id}`),
  create: (body: CreateWarehouseBody) => api.post<Warehouse>('/warehouses', body),
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

export const coldRoomsApi = {
  list: (q: ColdRoomQuery = {}) => api.get<Paginated<ColdRoom>>('/cold-rooms', { ...q }),
  create: (body: CreateColdRoomBody) => api.post<ColdRoom>('/cold-rooms', body),
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

export const devicesApi = {
  list: (q: DeviceQuery = {}) =>
    api.get<Paginated<Device>>('/devices', { ...q, unassigned: flag(q.unassigned) }),
  create: (body: CreateDeviceBody) => api.post<Device>('/devices', body),
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

export const productTypesApi = {
  list: (q: ProductTypeQuery = {}) =>
    api.get<Paginated<ProductType>>('/product-types', { ...q }),
  create: (body: CreateProductTypeBody) => api.post<ProductType>('/product-types', body),
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

export const batchesApi = {
  list: (q: BatchQuery = {}) => api.get<Paginated<Batch>>('/batches', { ...q }),
  create: (body: CreateBatchBody) => api.post<Batch>('/batches', body),
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

export const workShiftsApi = {
  list: (q: WorkShiftQuery = {}) => api.get<Paginated<WorkShift>>('/work-shifts', { ...q }),
  create: (body: CreateWorkShiftBody) => api.post<WorkShift>('/work-shifts', body),
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

export const usersApi = {
  list: (q: UserQuery = {}) => api.get<Paginated<User>>('/users', { ...q }),
  create: (body: CreateUserBody) => api.post<User>('/users', body),
}
