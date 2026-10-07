import type {
  AiRiskLevel,
  AiViolationType,
  AlertStatus,
  ChannelRole,
  DeviceStatusChangeTrigger,
  AlertType,
  BatchStatus,
  ChannelType,
  CommandAction,
  CommandStatus,
  FanFault,
  DeviceStatus,
  ProductUnit,
  UserRole,
  UserStatus,
  WorkShiftStatus,
} from '@/api/types'

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Quản trị viên',
  manager: 'Quản lý kho',
  technician: 'Kỹ thuật viên',
  staff: 'Nhân viên',
}

export const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  registered: 'Đã đăng ký',
  provisioned: 'Đã cấp phát',
  active: 'Hoạt động',
  offline: 'Mất kết nối',
  fault: 'Lỗi',
  maintenance: 'Bảo trì',
  decommissioned: 'Ngừng sử dụng',
}

export const ALERT_STATUS_LABEL: Record<AlertStatus, string> = {
  open: 'Đang mở',
  acknowledged: 'Đã tiếp nhận',
  resolved: 'Đã xử lý',
}

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  temperature_out_of_range: 'Nhiệt độ vượt ngưỡng',
  temperature_predicted: 'Dự báo vượt ngưỡng',
  device_fault: 'Thiết bị lỗi',
  offline: 'Mất kết nối',
  door_open_too_long: 'Cửa mở quá lâu',
  batch_temperature_out_of_range: 'Lô hàng sai nhiệt độ',
  batch_expiring_soon: 'Lô hàng sắp hết hạn',
}

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  active: 'Hoạt động',
  locked: 'Đã khoá',
}

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  in_stock: 'Đang lưu kho',
  expired: 'Hết hạn',
  removed: 'Đã xuất',
}

export const PRODUCT_UNIT_LABEL: Record<ProductUnit, string> = {
  kg: 'kg',
  liter: 'lít',
  piece: 'cái',
  box: 'thùng',
}

export const WORK_SHIFT_STATUS_LABEL: Record<WorkShiftStatus, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
  expired: 'Quá hạn',
}

export const COMMAND_ACTION_LABEL: Record<CommandAction, string> = {
  on: 'Bật',
  off: 'Tắt',
  auto: 'Tự động',
}

export const COMMAND_STATUS_LABEL: Record<CommandStatus, string> = {
  pending: 'Chờ gửi',
  sent: 'Đã gửi',
  done: 'Thành công',
  failed: 'Thất bại',
  expired: 'Hết hạn',
  superseded: 'Bị thay thế',
}

/** Reasons the firmware puts in a failed ack; anything else is shown as-is. */
export const COMMAND_ERROR_LABEL: Record<string, string> = {
  unsupported_channel: 'Thiết bị không hỗ trợ kênh này',
  unsupported_action: 'Thiết bị không hỗ trợ lệnh này',
  expired: 'Lệnh tới thiết bị khi đã hết hạn',
}

export const CHANNEL_TYPE_LABEL: Record<ChannelType, string> = {
  limit_switch: 'Công tắc cửa',
  temp_humidity_sensor: 'Cảm biến nhiệt ẩm',
  current_sensor: 'Cảm biến dòng',
  fan_motor: 'Quạt',
  indicator_light: 'Đèn báo',
  buzzer: 'Còi',
}

export const DEVICE_STATUS_TRIGGER_LABEL: Record<DeviceStatusChangeTrigger, string> = {
  manual: 'Thủ công',
  automated: 'Tự động',
}

export const CHANNEL_ROLE_LABEL: Record<ChannelRole, string> = {
  sensor: 'Cảm biến',
  actuator: 'Điều khiển',
}

export const AI_RISK_LEVEL_LABEL: Record<AiRiskLevel, string> = {
  NORMAL: 'Bình thường',
  WARNING: 'Cần theo dõi',
  CRITICAL: 'Nguy hiểm',
}

export const AI_VIOLATION_LABEL: Record<AiViolationType, string> = {
  NONE: 'Trong ngưỡng',
  OVERHEAT: 'Nguy cơ quá nhiệt',
  FREEZING: 'Nguy cơ quá lạnh',
}

/** What a fan supply fault means, short enough for a status line. */
export const FAN_FAULT_LABEL: Record<FanFault, string> = {
  no_power: 'Quạt mất nguồn',
  low_voltage: 'Điện áp quạt thấp',
  high_voltage: 'Điện áp quạt cao bất thường',
  stuck_on: 'Quạt đã tắt nhưng vẫn có điện',
}
