import { DatePicker } from '@/components/common/date-time-pickers'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useColdRoomLookup, type Option } from '@/lib/lookups'
import { useCurrentWarehouse } from '@/lib/useCurrentWarehouse'

// Building blocks for FilterDialog bodies. Filter drafts are all strings,
// with '' meaning "not filtered".

const ANY = 'any' // Radix Select can't hold an empty value.

export function SelectFilter({
  id,
  label,
  value,
  onChange,
  options,
  anyLabel = 'Tất cả',
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly Option[]
  anyLabel?: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? '' : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export function TextFilter({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

/** Two date pickers (YYYY-MM-DD, both inclusive) that keep from ≤ to. */
export function DateRangeFilter({
  id,
  fromLabel,
  toLabel = 'Đến ngày',
  from,
  to,
  onFromChange,
  onToChange,
}: {
  id: string
  fromLabel: string
  toLabel?: string
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field>
        <FieldLabel htmlFor={`${id}-from`}>{fromLabel}</FieldLabel>
        <DatePicker
          id={`${id}-from`}
          value={from}
          max={to || undefined}
          onChange={onFromChange}
          placeholder="Không giới hạn"
          clearable
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-to`}>{toLabel}</FieldLabel>
        <DatePicker
          id={`${id}-to`}
          value={to}
          min={from || undefined}
          onChange={onToChange}
          placeholder="Không giới hạn"
          clearable
        />
      </Field>
    </div>
  )
}

/**
 * Warehouse + cold room pickers. The cold room list narrows to the chosen
 * warehouse, and picking another warehouse drops a cold room outside it.
 */
/**
 * Cold room filter limited to the header's current warehouse (see
 * useCurrentWarehouse); with "Tất cả kho", every room, named with its
 * warehouse.
 */
export function ColdRoomFilter({
  value,
  onChange,
}: {
  value: string
  onChange: (coldRoomId: string) => void
}) {
  const { warehouseId, warehouses } = useCurrentWarehouse()
  const coldRooms = useColdRoomLookup()
  const options = coldRooms.items
    .filter((r) => !warehouseId || r.warehouseId === warehouseId)
    .map((r) => ({
      value: r.id,
      label: warehouseId ? r.name : `${r.name} · ${warehouses.label(r.warehouseId)}`,
    }))

  return (
    <SelectFilter id="f-cold-room" label="Phòng lạnh" value={value} options={options} onChange={onChange} />
  )
}
