import { notificationsApi } from '@/api/endpoints'
import { mutationErrorText } from '@/lib/forms'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

/** "Đánh dấu đã đọc tất cả": shared by the header bell and the notifications page. */
export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: ({ updated }) =>
      toast.success(updated > 0 ? `Đã đánh dấu ${updated} thông báo là đã đọc` : 'Không còn thông báo chưa đọc'),
    onError: (err) => toast.error('Không đánh dấu được thông báo', { description: mutationErrorText(err) }),
    // Badge count, the bell's list and the page all live under this prefix.
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
