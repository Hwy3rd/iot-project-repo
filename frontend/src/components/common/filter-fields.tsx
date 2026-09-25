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
import { useColdRoomLookup, useWarehouseLookup, type Option } from '@/lib/lookups'

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
export function LocationFilter({
  warehouseId,
  coldRoomId,
  onChange,
}: {
  warehouseId: string
  coldRoomId: string
  onChange: (patch: { warehouseId?: string; coldRoomId?: string }) => void
}) {
  const warehouses = useWarehouseLookup()
  const coldRooms = useColdRoomLookup()
  const roomOptions = coldRooms.items
    .filter((r) => !warehouseId || r.warehouseId === warehouseId)
    .map((r) => ({ value: r.id, label: r.name }))

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectFilter
        id="f-warehouse"
        label="Kho"
        value={warehouseId}
        options={warehouses.options}
        onChange={(v) => {
          const room = coldRooms.get(coldRoomId)
          onChange(
            room && v && room.warehouseId !== v
              ? { warehouseId: v, coldRoomId: '' }
              : { warehouseId: v },
          )
        }}
      />
      <SelectFilter
        id="f-cold-room"
        label="Phòng lạnh"
        value={coldRoomId}
        options={roomOptions}
        onChange={(v) => onChange({ coldRoomId: v })}
      />
    </div>
  )
}
