import type { User } from '@/api/types'
import { DetailList } from '@/components/common/RowDetail'
import { UserStatusBadge } from '@/components/common/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/format'
import { ROLE_LABEL } from '@/lib/labels'
import { useWarehouseLookup } from '@/lib/lookups'

/** Account facts: contact, role, status and dates. */
export function ProfileInfo({ user }: { user: User }) {
  return (
    <DetailList
      fields={[
        { label: 'Tên đăng nhập', value: <span translate="no">{user.username}</span> },
        { label: 'Vai trò', value: ROLE_LABEL[user.role] },
        { label: 'Email', value: user.email && <span className="break-all">{user.email}</span> },
        { label: 'Số điện thoại', value: user.phone },
        { label: 'Trạng thái', value: <UserStatusBadge status={user.status} /> },
        { label: 'Đăng nhập gần nhất', value: formatDateTime(user.lastLoginAt) },
        { label: 'Ngày tạo tài khoản', value: formatDateTime(user.createdAt) },
      ]}
    />
  )
}

/**
 * The warehouses you work in. GET /warehouses already returns only those
 * (all of them for an Admin, who isn't assigned to any).
 */
export function AssignedWarehouses({ user }: { user: User }) {
  const warehouses = useWarehouseLookup()
  if (user.role === 'admin') {
    return <p className="text-muted-foreground">Quản trị viên xem được mọi kho, không cần phân công.</p>
  }
  if (warehouses.items.length === 0) {
    return (
      <p className="text-muted-foreground">
        Bạn chưa được phân công vào kho nào. Liên hệ quản trị viên để được gán kho.
      </p>
    )
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {warehouses.items.map((w) => (
        <li key={w.id}>
          <Badge variant="secondary" className="h-auto py-1 text-sm">
            {w.name} <span className="font-mono text-muted-foreground" translate="no">{w.code}</span>
          </Badge>
        </li>
      ))}
    </ul>
  )
}
