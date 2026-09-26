import { usersApi } from '@/api/endpoints'
import type { User } from '@/api/types'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { mutationErrorText } from '@/lib/forms'
import { displayName } from '@/lib/users'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Lock, LockOpen } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

/**
 * Admin only. Locking keeps the account and its history but blocks login at
 * once (open sessions are cut); never offered on your own account.
 */
export function UserLockActions({
  user,
  isSelf,
  onChanged,
}: {
  user: User
  isSelf: boolean
  onChanged: (user: User) => void
}) {
  const qc = useQueryClient()
  const [confirm, setConfirm] = useState(false)
  const toggle = useMutation({
    mutationFn: () => (user.status === 'active' ? usersApi.lock(user.id) : usersApi.unlock(user.id)),
    onSuccess: (updated) => {
      toast.success(updated.status === 'locked' ? 'Đã khoá tài khoản' : 'Đã mở khoá tài khoản', {
        description: displayName(updated),
      })
      setConfirm(false)
      void qc.invalidateQueries({ queryKey: ['users'] })
      onChanged(updated)
    },
    onError: (err) => toast.error('Không thực hiện được', { description: mutationErrorText(err) }),
  })

  if (isSelf) return null
  if (user.status === 'locked') {
    return (
      <Button type="button" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
        {toggle.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
        Mở khoá
      </Button>
    )
  }
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setConfirm(true)}>
        <Lock aria-hidden="true" />
        Khoá tài khoản
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Khoá tài khoản ${displayName(user)}?`}
        description="Người này bị đăng xuất ngay và không đăng nhập được nữa. Tài khoản và lịch sử thao tác vẫn được giữ; có thể mở khoá lại bất cứ lúc nào."
        confirmLabel="Khoá tài khoản"
        destructive
        pending={toggle.isPending}
        onConfirm={() => toggle.mutate()}
      />
    </>
  )
}
