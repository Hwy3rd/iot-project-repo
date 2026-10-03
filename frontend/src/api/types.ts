// Shapes mirror the backend response DTOs (docs/API_DESIGN.md, docs/DATABASE_DESIGN.md).
// Dates arrive as ISO strings over JSON.

export type UserRole = 'admin' | 'manager' | 'staff' | 'technician'
export type UserStatus = 'active' | 'locked'
export type ProductUnit = 'kg' | 'liter' | 'piece' | 'box'
export type BatchStatus = 'in_stock' | 'expired' | 'removed'
export type WorkShiftStatus = 'pending' | 'approved' | 'rejected' | 'expired'
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
export type CommandStatus = 'pending' | 'sent' | 'done' | 'failed' | 'expired' | 'superseded'
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
  /**
   * End of a temporary block from too many failed logins (it may cover only
   * the IPs the failures came from). Only on GET /users, GET /users/:id and
   * POST /users/:id/unlock.
   */
  loginBlockedUntil?: string | null
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

/** GET /cold-rooms/:id/inventory: one row per product type held in the room. */
export interface ColdRoomInventoryItem {
  productTypeId: string
  productTypeName: string
  category: string | null
  unit: ProductUnit
  storageTempMin: number | null
  storageTempMax: number | null
  /** Batches not yet taken out (in stock or expired). */
  batchCount: number
  totalQuantity: number
  /** YYYY-MM-DD of the batch that expires first. */
  nearestExpiry: string
  expiredBatchCount: number
  /** Not yet expired, but expiring within `expiringSoonDays`. */
  expiringSoonBatchCount: number
}

export interface ColdRoomInventory {
  coldRoomId: string
  /** YYYY-MM-DD (business timezone) the expiry counts are relative to. */
  asOf: string
  expiringSoonDays: number
  totalBatches: number
  /** Soonest nearestExpiry first. */
  items: ColdRoomInventoryItem[]
}

export interface Shift {
  id: string
  name: string
  /** HH:mm:ss, business-timezone (UTC+7) wall clock; endTime <= startTime = ends the next day. */
  startTime: string
  endTime: string
  createdAt: string
  updatedAt: string
}

/** One attendance request: a Staff member checking in to a shift, reviewed by a Manager. */
export interface WorkShift {
  id: string
  shiftId: string
  staffId: string
  warehouseId: string
  /** YYYY-MM-DD, the day the shift starts (a night shift after midnight belongs to the day before). */
  workDate: string
  /** Snapshot of the shift template's times on workDate. */
  scheduledStartAt: string
  scheduledEndAt: string
  status: WorkShiftStatus
  /** When the request was sent; null only on records older than check-in requests. */
  checkInAt: string | null
  /** Computed by the server: whole minutes checkInAt came after scheduledStartAt (0 = on time); null without a check-in. */
  lateMinutes: number | null
  checkOutAt: string | null
  reviewedBy: string | null
  reviewedAt: string | null
  rejectReason: string | null
  createdAt: string
  updatedAt: string
}

/** GET /work-shifts/me — the caller's own check-in state. */
export interface Attendance {
  /** The approved shift being worked now (until its end + 5 min grace); null = must check in. */
  active: WorkShift | null
  /** The shift open for check-in right now (from 15 min before its start); null between shifts. */
  open: {
    shiftId: string
    /** The shift template's name. */
    name: string
    workDate: string
    scheduledStartAt: string
    scheduledEndAt: string
  } | null
  /** The caller's request for `open`, whatever its status. */
  request: WorkShift | null
  /** Warehouses where the caller is Staff. */
  warehouses: { id: string; name: string; code: string }[]
}

export interface Command {
  id: string
  channelId: string
  issuedBy: string | null
  action: CommandAction
  payload: Record<string, unknown> | null
  status: CommandStatus
  createdAt: string
  /** Last publish to the broker; null while still pending. */
  sentAt: string | null
  /** Publishes so far (the server retries until an ack or expiresAt). */
  attempts: number
  expiresAt: string
  ackAt: string | null
  /** Device-reported reason when status is failed. */
  errorReason: string | null
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

/** A user assigned to a warehouse; they work there with their account role. */
export type DeviceStatusChangeTrigger = 'manual' | 'automated'

/** GET /devices/:id/status-history — one status transition. */
export interface DeviceStatusChange {
  id: string
  deviceId: string
  oldStatus: DeviceStatus | null
  newStatus: DeviceStatus
  /** Null for a change the system made on its own. */
  changedBy: string | null
  trigger: DeviceStatusChangeTrigger
  reason: string | null
  changedAt: string
}

/** GET /devices/:id/telemetry/hourly — one hour of one device. */
export interface TelemetryHourly {
  deviceId: string
  coldRoomId: string
  /** Start of the hour. */
  hourBucket: string
  sampleCount: number
  avgTemp: number | null
  minTemp: number | null
  maxTemp: number | null
  outOfRangeCount: number
  sensorErrorCount: number
  /** Over the samples that reported humidity; null when none did. */
  avgHumidity?: number | null
  minHumidity?: number | null
  maxHumidity?: number | null
  /** Absent/null on hours computed before these counts existed. */
  doorOpenCount?: number | null
  fanPowerFaultCount?: number | null
}

/**
 * Device state sent with each reading by the ESP32 firmware (v1.1+). null
 * (or absent, on older samples) = the device didn't report it — older
 * firmware, simulators.
 */
export interface TelemetryDeviceState {
  /** Relative humidity, %. */
  humidity?: number | null
  /** Fan relay switched on. */
  fanOn?: boolean | null
  /** Supply voltage at the fan, V. */
  fanVoltage?: number | null
  /** Fan is on but its supply dropped or spiked. */
  fanPowerFault?: boolean | null
  /** The device's local buzzer alarm is sounding. */
  alarmActive?: boolean | null
}

/** GET /devices/:id/telemetry/raw — one sample, kept only briefly. */
export type TelemetryRaw = {
  deviceId: string
  coldRoomId: string
  ts: string
  temperature: number | null
  doorOpen: boolean
  sensorFault: boolean
  outOfRange: boolean
} & TelemetryDeviceState

/** POST /devices/:id/claim-code — the code itself is only ever returned here. */
export interface ClaimCode {
  claimCode: string
  claimCodeExpiresAt: string
}

export interface WarehouseStaff {
  userId: string
  warehouseId: string
  createdAt: string
  user?: {
    id: string
    username: string
    fullName: string | null
    email: string | null
    phone: string | null
    imageUrls: string[] | null
    role: UserRole
  }
}

/** Response of every `POST /<resource>/bulk-delete` (best effort, per row). */
export interface BulkDeleteResult {
  deleted: string[]
  failed: { id: string; statusCode: number; message: string }[]
}

/** GET /cold-rooms/status — live overview of one room. */
export interface ColdRoomStatus {
  coldRoomId: string
  warehouseId: string
  /** Newest sample from any device in the room; null if none is kept. */
  latest: ({
    ts: string
    /** The device that sent this sample. */
    deviceId?: string
    /**
     * Channel types that device declares; decides which optional fields to
     * show or flag as missing (lib/channel-readings.ts). Absent from older
     * servers, [] when the device declares none.
     */
    declaredChannels?: ChannelType[]
    temperature: number | null
    doorOpen: boolean
    sensorFault: boolean
    /** Judged against the room's thresholds when the sample arrived. */
    outOfRange: boolean
  } & TelemetryDeviceState) | null
  /** Installed devices, by status. */
  devices: { total: number } & Partial<Record<DeviceStatus, number>>
  /** Alerts still open or acknowledged. */
  activeAlerts: number
}

export type TelemetryRange = '1h' | '6h' | '24h'

/** Values the AI service returns (ai-service/ai_service.py). */
export type AiViolationType = 'NONE' | 'OVERHEAT' | 'FREEZING'
export type AiRiskLevel = 'NORMAL' | 'WARNING' | 'CRITICAL'

export interface ColdRoomPrediction {
  /** When the forecast was made; predictedTemp15m is for 15 minutes later. */
  predictedAt: string
  predictedTemp15m: number
  willExceedThreshold: boolean
  violationType: AiViolationType
  riskLevel: AiRiskLevel
  recommendation: string
}

/** GET /cold-rooms/:id/telemetry — one room's temperature, bucketed. */
export interface ColdRoomSeries {
  coldRoomId: string
  from: string
  to: string
  bucketMinutes: number
  tempMin: number
  tempMax: number
  /** Only buckets that had samples; gaps are missing buckets. */
  points: {
    t: string
    avg: number | null
    min: number | null
    max: number | null
    samples: number
    outOfRange: number
    doorOpen: number
    sensorFault: number
    /** Average humidity (%); null when no sample reported it. */
    humidity?: number | null
    /** Samples that reported a fan power fault. */
    fanPowerFault?: number
  }[]
  prediction?: ColdRoomPrediction | null
}

export type ChatMessageRole = 'user' | 'assistant' | 'tool' | 'system'

/** One chatbot conversation; `title` is set from the first message. */
export interface ChatConversation {
  id: string
  userId: string
  title: string | null
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
}

/**
 * A stored chat message. Besides the user's questions and the assistant's
 * replies, a turn also stores the assistant's tool calls and their results
 * (role `tool`, or `assistant` with `toolCalls` and no content).
 */
export interface ChatMessage {
  id: string
  conversationId: string
  role: ChatMessageRole
  content: string | null
  toolCalls: { id: string; name: string; arguments: unknown }[] | null
  toolCallId: string | null
  toolName: string | null
  createdAt: string
}
