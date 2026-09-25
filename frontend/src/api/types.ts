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
  capacityVolumeM3?: number | null
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
