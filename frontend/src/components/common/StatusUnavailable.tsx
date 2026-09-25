import { Alert, AlertDescription } from '@/components/ui/alert'
import { CircleAlert } from 'lucide-react'

/** Shown above a grid when the live status request failed. */
export function StatusUnavailable() {
  return (
    <div className="px-4 pt-4">
      <Alert>
        <CircleAlert aria-hidden="true" />
        <AlertDescription>
          Không tải được trạng thái trực tiếp (nhiệt độ, thiết bị, cảnh báo). Đang hiển thị thông tin cấu hình;
          trang sẽ tự thử lại.
        </AlertDescription>
      </Alert>
    </div>
  )
}
