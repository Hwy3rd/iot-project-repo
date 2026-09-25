// Shapes mirror the backend response DTOs (docs/API_DESIGN.md, docs/DATABASE_DESIGN.md).
// Dates arrive as ISO strings over JSON.

export type UserRole = 'admin' | 'manager' | 'staff' | 'technician'
export type UserStatus = 'active' | 'locked'
export type ProductUnit = 'kg' | 'liter' | 'piece' | 'box'
export type BatchStatus = 'in_stock' | 'expired' | 'removed'
export type ShiftType = 'morning' | 'afternoon' | 'night'
export type WorkShiftStatus = 'scheduled' | 'checked_in' | 'completed' | 'absent'
export type DeviceStatus =
  | 'registered'
  | 'provisioned'
  | 'active'
  | 'offline'
  | 'fault'
  | 'maintenance'
  | 'decommissioned'
export type ChannelType =
  | 'limit_switch'
  | 'temp_humidity_sensor'
  | 'current_sensor'
  | 'fan_motor'
  | 'indicator_light'
  | 'buzzer'
export type CommandAction = 'on' | 'off'
export type CommandStatus = 'pending' | 'sent' | 'done' | 'failed'
export type AlertType =
  | 'temperature_out_of_range'
  | 'temperature_predicted'
  | 'device_fault'
  | 'offline'
  | 'door_open_too_long'
  | 'batch_temperature_out_of_range'
  | 'batch_expiring_soon'
export type AlertStatus = 'open' | 'acknowledged' | 'resolved'
export type AlertResolution = 'auto' | 'manual'
export type NotificationStatus = 'pending' | 'sent' | 'failed'

export interface ApiEnvelope<T> {
  success: true
  statusCode: number
  message: string
  data: T
}

export interface ApiErrorBody {
  success: false
  statusCode: number
  path: string
  timestamp: string
  message: string
  errors?: string[]
}

export interface PageMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface Paginated<T> {
  items: T[]
  meta: PageMeta
}

export interface PageQuery {
  page?: number
  limit?: number
}

export interface User {
  id: string
  username: string
  email: string | null
  phone: string | null
  fullName: string | null
  imageUrls: string[] | null
  role: UserRole
  status: UserStatus
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Warehouse {
  id: string
  name: string
  code: string
  address: string | null
  imageUrls: string[] | null
  createdAt: string
  updatedAt: string
}

export interface ColdRoom {
  id: string
  warehouseId: string
  name: string
  tempMin: number
  tempMax: number
  hysteresis: number
  doorOpenMaxSeconds: number
  capacityPallets: number | null
  capacityWeightKg: number | null
  capacityVolumeM3: number | null
  createdAt: string
  updatedAt: string
}

export interface Device {
  id: string
  uniqueId: string
  coldRoomId: string | null
  firmwareVersion: string | null
  status: DeviceStatus
  lastHeartbeatAt: string | null
  claimCodeExpiresAt: string | null
  claimedAt: string | null
  decommissionedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Alert {
  id: string
  coldRoomId: string
  deviceId: string | null
  batchId: string | null
  type: AlertType
  status: AlertStatus
  triggerValue: number | null
  threshold: number | null
  details: Record<string, unknown> | null
  createdAt: string
  acknowledgedBy: string | null
  acknowledgedAt: string | null
  resolvedBy: string | null
  resolvedAt: string | null
  resolution: AlertResolution | null
  updatedAt: string
}

export interface AppNotification {
  id: string
  userId: string
  alertId: string | null
  title: string
  body: string
  status: NotificationStatus
  createdAt: string
  sentAt: string | null
  readAt: string | null
}

export interface ProductType {
  id: string
  name: string
  category: string | null
  unit: ProductUnit
  storageTempMin: number | null
  storageTempMax: number | null
  imageUrls: string[] | null
  createdAt: string
  updatedAt: string
}

export interface Batch {
  id: string
  coldRoomId: string
  productTypeId: string
  batchCode: string
  quantity: number
  supplier: string | null
  /** YYYY-MM-DD */
  receivedAt: string
  /** YYYY-MM-DD */
  expiryDate: string
  removedAt: string | null
  status: BatchStatus
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface Shift {
  id: string
  shiftType: ShiftType
  /** HH:mm:ss */
  startTime: string
  endTime: string
  createdAt: string
  updatedAt: string
}

export interface WorkShift {
  id: string
  shiftId: string
  staffId: string
  warehouseId: string
  /** YYYY-MM-DD */
  workDate: string
  scheduledStartAt: string
  scheduledEndAt: string
  status: WorkShiftStatus
  checkInAt: string | null
  checkOutAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Command {
  id: string
  channelId: string
  issuedBy: string | null
  action: CommandAction
  payload: Record<string, unknown> | null
  status: CommandStatus
  createdAt: string
  ackAt: string | null
}

export interface AuditLog {
  id: string
  userId: string | null
  warehouseId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export type ChannelRole = 'sensor' | 'actuator'

export interface DeviceChannel {
  id: string
  deviceId: string
  channelType: ChannelType
  channelRole: ChannelRole
  label: string | null
  createdAt: string
  updatedAt: string
}

export interface WarehouseStaff {
  userId: string
  warehouseId: string
  /** The user's role inside this warehouse. */
  role: UserRole
  createdAt: string
  user?: { id: string; username: string; fullName: string | null }
}
