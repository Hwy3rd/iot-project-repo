import type { UserRole } from '@/api/types'
import {
  Bell,
  Bot,
  Boxes,
  CalendarClock,
  Clock,
  Cpu,
  LayoutDashboard,
  type LucideIcon,
  Package,
  ScrollText,
  Siren,
  SlidersHorizontal,
  Thermometer,
  Users,
  Warehouse,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Global roles that see this item; omitted = everyone. Mirrors docs/RBAC.md §4. */
  roles?: readonly UserRole[]
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    label: 'Giám sát',
    items: [
      { to: '/', label: 'Tổng quan', icon: LayoutDashboard },
      { to: '/alerts', label: 'Cảnh báo', icon: Siren },
      { to: '/devices', label: 'Thiết bị', icon: Cpu },
      { to: '/commands', label: 'Lệnh điều khiển', icon: SlidersHorizontal },
    ],
  },
  {
    label: 'Vận hành',
    items: [
      { to: '/warehouses', label: 'Kho', icon: Warehouse },
      { to: '/cold-rooms', label: 'Phòng lạnh', icon: Thermometer },
      { to: '/batches', label: 'Lô hàng', icon: Boxes, roles: ['admin', 'manager', 'staff'] },
      {
        to: '/work-shifts',
        label: 'Ca trực',
        icon: CalendarClock,
        roles: ['admin', 'manager', 'staff'],
      },
    ],
  },
  {
    label: 'Danh mục',
    items: [
      { to: '/product-types', label: 'Loại sản phẩm', icon: Package },
      { to: '/shifts', label: 'Mẫu ca', icon: Clock },
    ],
  },
  {
    label: 'Quản trị',
    items: [
      { to: '/users', label: 'Người dùng', icon: Users, roles: ['admin'] },
      { to: '/audit-logs', label: 'Nhật ký hệ thống', icon: ScrollText, roles: ['admin', 'manager'] },
    ],
  },
  {
    label: 'Khác',
    items: [
      { to: '/notifications', label: 'Thông báo', icon: Bell },
      { to: '/chatbot', label: 'Trợ lý AI', icon: Bot },
    ],
  },
]
