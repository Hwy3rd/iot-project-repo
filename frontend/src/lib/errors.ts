import { ApiError } from '@/api/client'

export function errorText(err: unknown) {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'Bạn không có quyền xem dữ liệu này.'
    return err.message
  }
  return 'Đã xảy ra lỗi không xác định.'
}
