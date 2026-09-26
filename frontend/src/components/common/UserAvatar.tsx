import type { User } from '@/api/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { avatarUrl, displayName } from '@/lib/users'
import { cn } from '@/lib/utils'

type AvatarUser = Pick<User, 'username' | 'fullName' | 'imageUrls'>

/** Photo, or the first letter of the name on a tinted circle. */
export function UserAvatar({ user, className }: { user: AvatarUser; className?: string }) {
  const url = avatarUrl(user)
  return (
    <Avatar className={cn('size-8', className)}>
      {url && <AvatarImage src={url} alt="" className="object-cover" />}
      <AvatarFallback className="bg-primary/10 font-semibold text-primary">
        {displayName(user).trim().charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  )
}
