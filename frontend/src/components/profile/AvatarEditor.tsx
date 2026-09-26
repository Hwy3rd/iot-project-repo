import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { UserAvatar } from '@/components/common/UserAvatar'
import { Button } from '@/components/ui/button'
import { mutationErrorText } from '@/lib/forms'
import { imageFilesError } from '@/lib/images'
import { useAuth } from '@/auth/auth-context'
import type { User } from '@/api/types'
import { useUserAvatar } from '@/lib/useUserAvatar'
import { avatarUrl } from '@/lib/users'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

/**
 * An avatar, large, with "Đổi ảnh" / "Xoá ảnh" — yours by default, or
 * `user`'s (Admin editing another account). Changes apply at once.
 */
export function AvatarEditor({ user: target, className }: { user?: User; className?: string }) {
  const { user: me } = useAuth()
  const user = target ?? me
  const { setAvatar, removeAvatar } = useUserAvatar(user)
  const inputRef = useRef<HTMLInputElement>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  if (!user) return null
  const hasAvatar = !!avatarUrl(user)
  const busy = setAvatar.isPending || removeAvatar.isPending

  const onPick = (file: File | undefined) => {
    if (!file) return
    const error = imageFilesError([file])
    if (error) {
      toast.error(error)
      return
    }
    setAvatar.mutate(file, {
      onSuccess: () => toast.success('Đã cập nhật ảnh đại diện'),
      onError: (err) => toast.error('Không đổi được ảnh', { description: mutationErrorText(err) }),
    })
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <UserAvatar user={user} className={className ?? 'size-28 text-4xl'} />
        {busy && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-background/60" role="status">
            <Loader2 className="size-6 animate-spin" aria-hidden="true" />
            <span className="sr-only">Đang cập nhật ảnh…</span>
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          onPick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Camera aria-hidden="true" />
          {hasAvatar ? 'Đổi ảnh' : 'Tải ảnh lên'}
        </Button>
        {hasAvatar && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmRemove(true)}>
            <Trash2 aria-hidden="true" />
            Xoá ảnh
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Ảnh JPG, PNG… tối đa 5 MB.</p>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Xoá ảnh đại diện?"
        description="Chữ cái đầu của tên sẽ được hiển thị thay cho ảnh."
        confirmLabel="Xoá ảnh"
        destructive
        pending={removeAvatar.isPending}
        onConfirm={() =>
          removeAvatar.mutate(undefined, {
            onSuccess: () => {
              toast.success('Đã xoá ảnh đại diện')
              setConfirmRemove(false)
            },
            onError: (err) => toast.error('Không xoá được ảnh', { description: mutationErrorText(err) }),
          })
        }
      />
    </div>
  )
}
