import type {
  AlertStatus,
  AlertType,
  BatchStatus,
  ChannelType,
  CommandAction,
  CommandStatus,
  DeviceStatus,
  ProductUnit,
  ShiftType,
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

export const SHIFT_TYPE_LABEL: Record<ShiftType, string> = {
  morning: 'Ca sáng',
  afternoon: 'Ca chiều',
  night: 'Ca tối',
}

export const WORK_SHIFT_STATUS_LABEL: Record<WorkShiftStatus, string> = {
  scheduled: 'Đã lên lịch',
  checked_in: 'Đang trực',
  completed: 'Hoàn thành',
  absent: 'Vắng mặt',
}

export const COMMAND_ACTION_LABEL: Record<CommandAction, string> = {
  on: 'Bật',
  off: 'Tắt',
}

export const COMMAND_STATUS_LABEL: Record<CommandStatus, string> = {
  pending: 'Chờ gửi',
  sent: 'Đã gửi',
  done: 'Thành công',
  failed: 'Thất bại',
}

export const CHANNEL_TYPE_LABEL: Record<ChannelType, string> = {
  limit_switch: 'Công tắc cửa',
  temp_humidity_sensor: 'Cảm biến nhiệt ẩm',
  current_sensor: 'Cảm biến dòng',
  fan_motor: 'Quạt',
  indicator_light: 'Đèn báo',
  buzzer: 'Còi',
}
