import { usersApi } from '@/api/endpoints'
import type { User } from '@/api/types'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { mutationErrorText } from '@/lib/forms'
import { displayName, loginBlockedUntil } from '@/lib/users'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Lock, LockOpen, ShieldOff } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

/**
 * Admin only. Locking keeps the account and its history but blocks login at
 * once (open sessions are cut); never offered on your own account. Unlocking
 * also lifts a temporary block from too many failed logins, so an active
 * account under one gets that button too.
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
  const onSuccess = (message: string) => (updated: User) => {
    toast.success(message, { description: displayName(updated) })
    setConfirm(false)
    void qc.invalidateQueries({ queryKey: ['users'] })
    onChanged(updated)
  }
  const onError = (err: Error) => toast.error('Không thực hiện được', { description: mutationErrorText(err) })
  const lock = useMutation({
    mutationFn: () => usersApi.lock(user.id),
    onSuccess: onSuccess('Đã khoá tài khoản'),
    onError,
  })
  const unlock = useMutation({
    mutationFn: () => usersApi.unlock(user.id),
    onSuccess: onSuccess(user.status === 'locked' ? 'Đã mở khoá tài khoản' : 'Đã gỡ chặn đăng nhập'),
    onError,
  })

  if (isSelf) return null
  if (user.status === 'locked') {
    return (
      <Button type="button" variant="outline" disabled={unlock.isPending} onClick={() => unlock.mutate()}>
        {unlock.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
        Mở khoá
      </Button>
    )
  }
  return (
    <>
      {loginBlockedUntil(user) && (
        <Button type="button" variant="outline" disabled={unlock.isPending} onClick={() => unlock.mutate()}>
          {unlock.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldOff aria-hidden="true" />}
          Gỡ chặn đăng nhập
        </Button>
      )}
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
        pending={lock.isPending}
        onConfirm={() => lock.mutate()}
      />
    </>
  )
}
