import { warehousesApi } from '@/api/endpoints'
import type { User, Warehouse, WarehouseStaff } from '@/api/types'
import { Combobox } from '@/components/common/Combobox'
import { ErrorState, Spinner } from '@/components/common/States'
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
import { Label } from '@/components/ui/label'
import { mutationErrorText } from '@/lib/forms'
import { ROLE_LABEL } from '@/lib/labels'
import { shortId, useUserLookup } from '@/lib/lookups'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

// Warehouses hold few people; one page covers them.
const MEMBERS = { limit: 100 } as const

const memberName = (m: WarehouseStaff) =>
  m.user?.fullName ? `${m.user.fullName} (${m.user.username})` : (m.user?.username ?? shortId(m.userId))

const userName = (u: User) => (u.fullName ? `${u.fullName} (${u.username})` : u.username)

function useStaffMutations(warehouse: Warehouse) {
  const qc = useQueryClient()
  const onSettled = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['warehouses', warehouse.id, 'staff'] }),
      // Which warehouses Staff are in decides the check-in screen and review lists.
      qc.invalidateQueries({ queryKey: ['work-shifts'] }),
    ])
  const assign = useMutation({
    mutationFn: (userId: string) => warehousesApi.assignStaff(warehouse.id, userId),
    onError: (err) => toast.error('Không lưu được phân công', { description: mutationErrorText(err) }),
    onSettled,
  })
  const unassign = useMutation({
    mutationFn: (userId: string) => warehousesApi.unassignStaff(warehouse.id, userId),
    onError: (err) => toast.error('Không gỡ được nhân sự', { description: mutationErrorText(err) }),
    onSettled,
  })
  return { assign, unassign }
}

/**
 * People assigned to a warehouse, for the warehouse's detail dialog. Each
 * works there with their account role — it isn't set per warehouse. Admin
 * or a Manager of the warehouse may view it; only an Admin (`canManage`)
 * may add or remove people.
 */
export function WarehouseStaffSection({
  warehouse,
  canManage,
}: {
  warehouse: Warehouse
  canManage: boolean
}) {
  const members = useQuery({
    queryKey: ['warehouses', warehouse.id, 'staff', MEMBERS],
    queryFn: () => warehousesApi.staff(warehouse.id, MEMBERS),
  })
  // GET /users is Admin-only, which is exactly who may assign.
  const users = useUserLookup(canManage)
  const { assign, unassign } = useStaffMutations(warehouse)
  const [removing, setRemoving] = useState<WarehouseStaff | null>(null)

  const items = members.data?.items ?? []
  const assigned = new Set(items.map((m) => m.userId))
  const candidates = users.items.filter((u) => u.role !== 'admin' && !assigned.has(u.id))

  return (
    <section className="flex flex-col gap-3 border-t pt-4" aria-labelledby="warehouse-staff-heading">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="warehouse-staff-heading" className="font-medium">
          Nhân sự phụ trách
        </h3>
        {members.data && (
          <span className="text-sm text-muted-foreground">{members.data.meta.total} người</span>
        )}
      </div>

      {members.isPending ? (
        <Spinner />
      ) : members.isError ? (
        <ErrorState error={members.error} onRetry={() => members.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">
          Chưa có ai được phân công vào kho này.
          {canManage && ' Thêm người bên dưới để họ thấy và làm việc với kho.'}
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((m) => {
            const name = memberName(m)
            const busy = unassign.isPending && unassign.variables === m.userId
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 break-words">{name}</span>
                {m.user && <span className="text-sm text-muted-foreground">{ROLE_LABEL[m.user.role]}</span>}
                {canManage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setRemoving(m)}
                    disabled={busy}
                    aria-label={`Gỡ ${name} khỏi kho`}
                  >
                    {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {members.data && members.data.meta.total > items.length && (
        <p className="text-sm text-muted-foreground">
          Đang hiển thị {items.length}/{members.data.meta.total} người.
        </p>
      )}

      {canManage && members.isSuccess && (
        <AddMemberForm
          key={warehouse.id}
          candidates={candidates}
          pending={assign.isPending}
          onAdd={(user, reset) =>
            assign.mutate(user.id, {
              onSuccess: () => {
                toast.success('Đã phân công', { description: userName(user) })
                reset()
              },
            })
          }
        />
      )}

      {canManage && (
        <RemoveMemberDialog
          warehouse={warehouse}
          member={removing}
          pending={unassign.isPending}
          onClose={() => setRemoving(null)}
          onConfirm={(m) =>
            unassign.mutate(m.userId, {
              onSuccess: () => {
                toast.success('Đã gỡ khỏi kho', { description: memberName(m) })
                setRemoving(null)
              },
            })
          }
        />
      )}
    </section>
  )
}

function AddMemberForm({
  candidates,
  pending,
  onAdd,
}: {
  candidates: User[]
  pending: boolean
  onAdd: (user: User, reset: () => void) => void
}) {
  const [userId, setUserId] = useState('')
  const user = candidates.find((u) => u.id === userId)

  if (candidates.length === 0 && !userId) {
    return (
      <p className="text-sm text-muted-foreground">
        Mọi tài khoản (trừ quản trị viên) đã được phân công vào kho này.
      </p>
    )
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault()
        if (user) onAdd(user, () => setUserId(''))
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor="staff-user">Người dùng</Label>
        <Combobox
          id="staff-user"
          value={userId}
          onChange={setUserId}
          options={candidates.map((u) => ({
            value: u.id,
            label: userName(u),
            hint: ROLE_LABEL[u.role] + (u.status === 'locked' ? ' (đã khoá)' : ''),
          }))}
          placeholder="Chọn người dùng…"
          searchPlaceholder="Tìm theo tên hoặc tên đăng nhập…"
          emptyText="Không tìm thấy người dùng."
          disabled={pending}
        />
      </div>
      <Button type="submit" disabled={!user || pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
        Thêm
      </Button>
    </form>
  )
}

function RemoveMemberDialog({
  warehouse,
  member,
  pending,
  onClose,
  onConfirm,
}: {
  warehouse: Warehouse
  member: WarehouseStaff | null
  pending: boolean
  onClose: () => void
  onConfirm: (member: WarehouseStaff) => void
}) {
  return (
    <Dialog open={!!member} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gỡ {member && memberName(member)} khỏi kho?</DialogTitle>
          <DialogDescription>
            Người này sẽ không còn thấy và thao tác với kho {warehouse.name} ({warehouse.code}) nữa. Có thể
            phân công lại bất cứ lúc nào.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Huỷ
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={() => member && onConfirm(member)}
            disabled={pending}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
            Gỡ khỏi kho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
