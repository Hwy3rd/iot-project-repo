import { alertsApi } from '@/api/endpoints'
import type { Alert } from '@/api/types'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { mutationErrorText } from './forms'

export type AlertAction = 'acknowledge' | 'resolve'

/**
 * "Tiếp nhận" (anyone in scope, Staff on shift; open alerts) and "Xử lý
 * xong" (Admin/Manager/Technician; open or acknowledged). The backend has
 * the final say — this only decides which buttons to offer.
 */
export function useAlertActions() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const canResolve = hasRole(user?.role, ['admin', 'manager', 'technician'])

  const mutation = useMutation({
    mutationFn: ({ alert, action }: { alert: Alert; action: AlertAction }) =>
      action === 'acknowledge' ? alertsApi.acknowledge(alert.id) : alertsApi.resolve(alert.id),
    onSuccess: (_, { action }) => {
      toast.success(action === 'acknowledge' ? 'Đã tiếp nhận cảnh báo' : 'Đã xử lý cảnh báo')
      void qc.invalidateQueries({ queryKey: ['alerts'] })
      void qc.invalidateQueries({ queryKey: ['cold-rooms', 'status'] })
    },
    onError: (error) =>
      toast.error('Không thực hiện được', {
        description: mutationErrorText(error, {
          403: 'Bạn không có quyền với cảnh báo này (nhân viên cần đang trong ca để tiếp nhận).',
          409: 'Cảnh báo vừa được người khác cập nhật.',
        }),
      }),
  })

  return {
    canAcknowledge: (alert: Alert) => alert.status === 'open',
    canResolve: (alert: Alert) => canResolve && alert.status !== 'resolved',
    run: (alert: Alert, action: AlertAction) => mutation.mutateAsync({ alert, action }).catch(() => undefined),
    /** The alert whose action is in flight, if any. */
    pendingId: mutation.isPending ? mutation.variables?.alert.id : undefined,
  }
}
