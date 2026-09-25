import type { AlertStatus, AlertType, DeviceStatus, UserRole } from '@/api/types'

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
