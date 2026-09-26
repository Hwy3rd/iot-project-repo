import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { patchParams } from '@/lib/useListParams'
import { ALL_WAREHOUSES, useCurrentWarehouse } from '@/lib/useCurrentWarehouse'
import { Warehouse } from 'lucide-react'
import { useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'

// URL params that only make sense within the previous warehouse.
const WAREHOUSE_BOUND_PARAMS = { warehouseId: null, coldRoomId: null, room: null, page: null }

/** Header picker for the warehouse every screen works in (see useCurrentWarehouse). */
export function WarehouseSwitcher() {
  const current = useCurrentWarehouse()
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { select, warehouses } = current

  // Links into a warehouse (notifications, the warehouse cards, older
  // bookmarks) still say ?warehouseId=…: switch to it, then drop the param
  // so the header stays the only source of truth.
  const linked = params.get('warehouseId')
  useEffect(() => {
    if (!linked || !warehouses.settled) return
    if (warehouses.get(linked)) select(linked)
    setParams((prev) => patchParams(prev, { warehouseId: null }), { replace: true })
  }, [linked, warehouses, select, setParams])

  const change = (next: string) => {
    select(next)
    // A room's own page belongs to its warehouse; go back to the list.
    if (/^\/cold-rooms\/[^/]+/.test(pathname)) navigate('/cold-rooms')
    else setParams((prev) => patchParams(prev, WAREHOUSE_BOUND_PARAMS))
  }

  if (warehouses.settled && warehouses.items.length === 0) return null

  return (
    <Select value={current.value} onValueChange={change} disabled={!warehouses.settled}>
      <SelectTrigger aria-label="Kho đang làm việc" className="min-w-0 flex-1 basis-32 sm:w-80 sm:flex-none [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:justify-start">
        <Warehouse className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <SelectValue placeholder="Chọn kho…" />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {current.allowAll && <SelectItem value={ALL_WAREHOUSES}>Tất cả kho</SelectItem>}
        {warehouses.options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
