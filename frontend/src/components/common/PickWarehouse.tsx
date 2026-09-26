import { EmptyState } from '@/components/common/States'
import { Card } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCurrentWarehouse } from '@/lib/useCurrentWarehouse'

/**
 * For a screen that shows one warehouse at a time (monitoring, work shifts)
 * while the header is on "Tất cả kho": picking here switches the header too.
 */
export function PickWarehouse({ description }: { description: string }) {
  const { select, warehouses } = useCurrentWarehouse()
  return (
    <Card>
      <EmptyState
        title="Chọn một kho để xem"
        description={description}
        action={
          <Select onValueChange={select}>
            <SelectTrigger aria-label="Chọn kho" className="w-72 max-w-full">
              <SelectValue placeholder="Chọn kho…" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </Card>
  )
}
