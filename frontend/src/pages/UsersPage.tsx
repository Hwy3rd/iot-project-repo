import { usersApi, type UserQuery } from '@/api/endpoints'
import type { UserRole, UserStatus } from '@/api/types'
import { CreateUserDialog } from '@/components/users/CreateUserDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import { PageHeader } from '@/components/common/PageHeader'
import { UserStatusBadge } from '@/components/common/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { emptyFilters, labelOptions } from '@/lib/filters'
import { formatDateTime, formatRelative } from '@/lib/format'
import { ROLE_LABEL, USER_STATUS_LABEL } from '@/lib/labels'
import { param, useListParams } from '@/lib/useListParams'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const FILTER_KEYS = ['role', 'status'] as const
const NO_FILTERS = emptyFilters(FILTER_KEYS)

export function UsersPage() {
  const list = useListParams(FILTER_KEYS)
  const f = list.filters

  const params: UserQuery = {
    page: list.page,
    limit: list.limit,
    search: param(list.search),
    role: param(f.role) as UserRole | undefined,
    status: param(f.status) as UserStatus | undefined,
  }
  const query = useQuery({
    queryKey: ['users', params],
    queryFn: () => usersApi.list(params),
    placeholderData: keepPreviousData,
  })

  return (
    <>
      {/* The route itself is Admin-only, and so is creating accounts. */}
      <PageHeader
        title="Người dùng"
        description="Tài khoản, vai trò và khoá/mở khoá."
        actions={<CreateUserDialog />}
      />
      <ListCard
        list={list}
        query={query}
        noun="người dùng"
        search={{
          label: 'Tìm người dùng',
          placeholder: 'Tìm theo tài khoản, họ tên, email hoặc số điện thoại…',
        }}
        filters={
          <FilterDialog
            value={list.filters}
            emptyValue={NO_FILTERS}
            activeCount={list.activeFilterCount}
            onApply={list.setFilters}
            description="Thu hẹp danh sách theo vai trò và trạng thái tài khoản."
          >
            {(draft, set) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectFilter
                  id="f-role"
                  label="Vai trò"
                  value={draft.role}
                  options={labelOptions(ROLE_LABEL)}
                  onChange={(v) => set('role', v)}
                />
                <SelectFilter
                  id="f-status"
                  label="Trạng thái"
                  value={draft.status}
                  options={labelOptions(USER_STATUS_LABEL)}
                  onChange={(v) => set('status', v)}
                />
              </div>
            )}
          </FilterDialog>
        }
        empty={{ title: 'Chưa có người dùng nào', action: <CreateUserDialog /> }}
      >
        {(items) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Tài khoản</TableHead>
                <TableHead className="hidden md:table-cell">Liên hệ</TableHead>
                <TableHead className="hidden sm:table-cell">Vai trò</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="hidden pr-4 lg:table-cell">Đăng nhập cuối</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="pl-4 whitespace-normal">
                    <span className="font-medium">{u.fullName || u.username}</span>
                    <span className="block text-muted-foreground" translate="no">
                      {u.username}
                      <span className="sm:hidden"> · {ROLE_LABEL[u.role]}</span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden whitespace-normal md:table-cell">
                    <span className="block break-all">{u.email || '—'}</span>
                    {u.phone && (
                      <span className="block text-muted-foreground tabular-nums">{u.phone}</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{ROLE_LABEL[u.role]}</TableCell>
                  <TableCell>
                    <UserStatusBadge status={u.status} />
                  </TableCell>
                  <TableCell className="hidden pr-4 text-muted-foreground lg:table-cell">
                    {u.lastLoginAt ? (
                      <time dateTime={u.lastLoginAt} title={formatDateTime(u.lastLoginAt)}>
                        {formatRelative(u.lastLoginAt)}
                      </time>
                    ) : (
                      'Chưa đăng nhập'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListCard>
    </>
  )
}
