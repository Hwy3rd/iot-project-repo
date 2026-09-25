import { useAuth } from '@/auth/auth-context'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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
import { ChevronDown, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
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

  if (!user) return null
  const name = user.fullName || user.username
  const initial = name.trim().charAt(0).toUpperCase()

  async function onLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label={`Menu tài khoản ${name}`}>
          <Avatar className="size-7">
            {user.imageUrls?.[0] && <AvatarImage src={user.imageUrls[0]} alt="" />}
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 min-w-0 flex-col items-start text-left sm:flex">
            <span className="w-full truncate font-medium">{name}</span>
            <span className="text-xs font-normal text-muted-foreground">{ROLE_LABEL[user.role]}</span>
          </span>
          <ChevronDown className="text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground" translate="no">
            @{user.username}
          </p>
        </DropdownMenuLabel>
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
  )
}
