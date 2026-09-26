import { useAuth } from '@/auth/auth-context'
import { formatMinutes } from '@/lib/format'
import { useWorkShiftEvents } from '@/lib/useWorkShiftEvents'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

/**
 * Keeps work-shift screens live for everyone logged in, and toasts the
 * events meant for this user: a new request to review (Managers/Admins —
 * the server only sends it to reviewers of that warehouse), or the review
 * of their own request (Staff).
 */
export function WorkShiftNotifier() {
  const { user } = useAuth()
  const navigate = useNavigate()

  useWorkShiftEvents(!!user, (event) => {
    if (event.staffId === user?.id) {
      if (event.status === 'approved') toast.success('Yêu cầu chấm công đã được duyệt')
      if (event.status === 'rejected') toast.error('Yêu cầu chấm công bị từ chối')
      return
    }
    if (event.status === 'pending') {
      toast.info('Có yêu cầu chấm công mới', {
        description: event.lateMinutes ? `Đi trễ ${formatMinutes(event.lateMinutes)}` : undefined,
        action: {
          label: 'Xem',
          onClick: () => navigate(`/work-shifts?warehouseId=${event.warehouseId}`),
        },
      })
    }
  })
  return null
}
