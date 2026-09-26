import { usersApi, type UserQuery } from '@/api/endpoints'
import type { User, UserRole, UserStatus } from '@/api/types'
import { ResetPasswordAction } from '@/components/users/ResetPasswordAction'
import { CreateUserDialog, EditUserDialog } from '@/components/users/UserFormDialog'
import { UserLockActions } from '@/components/users/UserLockActions'
import { UserAvatar } from '@/components/common/UserAvatar'
import { useAuth } from '@/auth/auth-context'
import { hasRole } from '@/auth/permissions'
import { BulkDeleteDialog } from '@/components/common/BulkDeleteDialog'
import { FilterDialog } from '@/components/common/FilterDialog'
import { SelectFilter } from '@/components/common/filter-fields'
import { ListCard } from '@/components/common/ListCard'
import {
  DetailDialog,
  DetailList,
  RowActionsCell,
  RowActionsHead,
} from '@/components/common/RowDetail'
import { PageHeader } from '@/components/common/PageHeader'
import { SelectAllHead, SelectRowCell } from '@/components/common/row-selection'
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
import { rowOpenProps, useRowDialogs } from '@/lib/useRowDialogs'
import { useRowSelection } from '@/lib/useRowSelection'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

const FILTER_KEYS = ['role', 'status'] as const
const NO_FILTERS = emptyFilters(FILTER_KEYS)

export function UsersPage() {
  const { user } = useAuth()
  const canDelete = hasRole(user?.role, ['admin'])
  // The page itself is Admin-only.
  const canEdit = canDelete
  const rows = useRowDialogs<User>()
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
  // As last fetched, so an avatar changed from the edit dialog shows at once.
  const current = query.data?.items.find((u) => u.id === rows.item?.id) ?? rows.item
  const selection = useRowSelection(
    canDelete
      ? (query.data?.items ?? []).filter((u) => u.id !== user?.id).map((u) => ({ id: u.id, name: u.username }))
      : [],
    // Paging or resizing pages keeps the selection; a new search/filter starts over.
    JSON.stringify({ ...params, page: undefined, limit: undefined }),
  )

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
        selection={{
          count: selection.count,
          offPageCount: selection.offPageCount,
          onClear: selection.clear,
          actions: (
            <BulkDeleteDialog
              ids={selection.ids}
              noun="người dùng"
              bulkRemove={usersApi.bulkRemove}
              invalidate={[['users']]}
              onDone={selection.clear}
              failureText={{ 400: 'không thể xoá tài khoản của chính bạn' }}
              warning={
                <>Tài khoản bị xoá sẽ không đăng nhập được nữa và bị gỡ khỏi mọi kho. Tài khoản của chính bạn không chọn được.</>
              }
              describe={selection.nameOf}
            />
          ),
        }}
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
                {canDelete && (
                  <SelectAllHead selection={selection} label="Chọn tất cả người dùng trên trang" />
                )}
                <TableHead className="pl-4">Tài khoản</TableHead>
                <TableHead>Liên hệ</TableHead>
                <TableHead>Vai trò</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Đăng nhập cuối</TableHead>
                <RowActionsHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id} {...rowOpenProps(() => rows.view(u))}>
                  {canDelete && (
                    <SelectRowCell selection={selection} id={u.id} label={`Chọn người dùng ${u.username}`} />
                  )}
                  <TableCell className="pl-4 min-w-48 whitespace-normal">
                    <span className="flex items-center gap-3">
                      <UserAvatar user={u} className="size-9 shrink-0 text-sm" />
                      <span className="min-w-0">
                        <span className="block font-medium">{u.fullName || u.username}</span>
                        <span className="block text-muted-foreground" translate="no">
                          {u.username}
                        </span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="min-w-48 whitespace-normal">
                    <span className="block break-all">{u.email || '—'}</span>
                    {u.phone && (
                      <span className="block text-muted-foreground tabular-nums">{u.phone}</span>
                    )}
                  </TableCell>
                  <TableCell>{ROLE_LABEL[u.role]}</TableCell>
                  <TableCell>
                    <UserStatusBadge status={u.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.lastLoginAt ? (
                      <time dateTime={u.lastLoginAt} title={formatDateTime(u.lastLoginAt)}>
                        {formatRelative(u.lastLoginAt)}
                      </time>
                    ) : (
                      'Chưa đăng nhập'
                    )}
                  </TableCell>
                  <RowActionsCell
                    label={`người dùng ${u.username}`}
                    onView={() => rows.view(u)}
                    onEdit={canEdit ? () => rows.edit(u) : undefined}
                  />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListCard>

      {current && (
        <>
          <DetailDialog
            open={rows.viewing}
            onClose={rows.close}
            title={
              <span className="flex items-center gap-3">
                <UserAvatar user={current} className="size-12 shrink-0 text-lg" />
                {current.fullName || current.username}
              </span>
            }
            description={current.username}
            onEdit={canEdit ? () => rows.edit(current) : undefined}
            actions={
              <>
                <ResetPasswordAction user={current} isSelf={current.id === user?.id} />
                <UserLockActions user={current} isSelf={current.id === user?.id} onChanged={rows.view} />
              </>
            }
          >
            <DetailList
              fields={[
                {
                  label: 'Tên đăng nhập',
                  value: <span translate="no">{current.username}</span>,
                },
                { label: 'Họ và tên', value: current.fullName },
                { label: 'Vai trò', value: ROLE_LABEL[current.role] },
                { label: 'Trạng thái', value: <UserStatusBadge status={current.status} /> },
                { label: 'Email', value: current.email && <span className="break-all">{current.email}</span> },
                { label: 'Số điện thoại', value: current.phone },
                { label: 'Đăng nhập cuối', value: current.lastLoginAt ? formatDateTime(current.lastLoginAt) : 'Chưa đăng nhập' },
                { label: 'Ngày tạo', value: formatDateTime(current.createdAt) },
              ]}
            />
          </DetailDialog>
          {canEdit && (
            <EditUserDialog
              key={current.id}
              user={current}
              open={rows.editing}
              onClose={rows.close}
            />
          )}
        </>
      )}
    </>
  )
}
