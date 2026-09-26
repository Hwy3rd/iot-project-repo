import { useAuth } from '@/auth/auth-context'
import { UserAvatar } from '@/components/common/UserAvatar'
import { ProfileDialog } from '@/components/profile/ProfileDialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ROLE_LABEL } from '@/lib/labels'
import { ChevronDown, LogOut, Monitor, Moon, Sun, UserRound } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { useNavigate } from 'react-router'

const THEMES = [
  { value: 'light', label: 'Sáng', Icon: Sun },
  { value: 'dark', label: 'Tối', Icon: Moon },
  { value: 'system', label: 'Theo hệ thống', Icon: Monitor },
] as const

export function UserMenu() {
  const { user, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)

  if (!user) return null
  const name = user.fullName || user.username

  async function onLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label={`Menu tài khoản ${name}`}>
            <UserAvatar user={user} className="size-7 text-xs" />
            <span className="hidden max-w-40 min-w-0 flex-col items-start text-left sm:flex">
              <span className="w-full truncate font-medium">{name}</span>
              <span className="text-xs font-normal text-muted-foreground">{ROLE_LABEL[user.role]}</span>
            </span>
            <ChevronDown className="text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="flex items-center gap-2 font-normal">
            <UserAvatar user={user} className="size-9 text-sm" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{name}</span>
              <span className="block truncate text-xs text-muted-foreground" translate="no">
                @{user.username}
              </span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
            <UserRound aria-hidden="true" />
            Hồ sơ cá nhân
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Giao diện</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
            {THEMES.map(({ value, label, Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon aria-hidden="true" />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onLogout}>
            <LogOut aria-hidden="true" />
            Đăng xuất
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  )
}
