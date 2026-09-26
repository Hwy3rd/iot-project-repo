import { useAuth } from '@/auth/auth-context'
import { UserAvatar } from '@/components/common/UserAvatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ROLE_LABEL } from '@/lib/labels'
import { displayName } from '@/lib/users'
import { Pencil } from 'lucide-react'
import { Link } from 'react-router'
import { AssignedWarehouses, ProfileInfo } from './ProfileInfo'

/** Quick look at your own account from the user menu; editing is on /profile. */
export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth()
  if (!user) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="items-center text-center sm:items-center sm:text-center">
          <UserAvatar user={user} className="size-20 text-3xl" />
          <DialogTitle className="text-lg break-words">{displayName(user)}</DialogTitle>
          <DialogDescription>{ROLE_LABEL[user.role]}</DialogDescription>
        </DialogHeader>
        <ProfileInfo user={user} />
        <div className="flex flex-col gap-2 border-t pt-4">
          <h3 className="text-sm text-muted-foreground">Kho phụ trách</h3>
          <AssignedWarehouses user={user} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Đóng
            </Button>
          </DialogClose>
          <Button asChild>
            <Link to="/profile" onClick={() => onOpenChange(false)}>
              <Pencil aria-hidden="true" />
              Chỉnh sửa hồ sơ
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
