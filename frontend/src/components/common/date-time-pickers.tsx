import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { dayjs } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CalendarDays } from 'lucide-react'
import { useState } from 'react'
import { vi } from 'react-day-picker/locale'

// Date and time pickers that look and read the same in every browser —
// native <input type="date|time"> follow the browser's locale (e.g.
// 09/25/2026, 08:00 AM). Values stay the plain strings the API speaks:
// dates YYYY-MM-DD, times HH:mm (24h).

const ISO_DATE = 'YYYY-MM-DD'
const THIS_YEAR = new Date().getFullYear()

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = 'Chọn ngày…',
  clearable = false,
  disabled,
  invalid,
  className,
  onBlur,
  min,
  max,
  ariaLabel,
}: {
  id?: string
  /** For a picker without a visible <label>; the chosen date is appended. */
  ariaLabel?: string
  /** YYYY-MM-DD, or '' for none. */
  value: string
  /** Earliest / latest selectable day, YYYY-MM-DD (inclusive). */
  min?: string
  max?: string
  onChange: (value: string) => void
  placeholder?: string
  /** Offer "Bỏ chọn" (optional fields, filters). */
  clearable?: boolean
  disabled?: boolean
  invalid?: boolean
  className?: string
  onBlur?: () => void
}) {
  const [open, setOpen] = useState(false)
  const parsed = value ? dayjs(value) : null
  const selected = parsed?.isValid() ? parsed.toDate() : undefined

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) onBlur?.()
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-invalid={invalid}
          aria-label={
            ariaLabel &&
            `${ariaLabel}: ${selected ? dayjs(selected).format('DD/MM/YYYY') : placeholder}`
          }
          className={cn(
            // Styled like <Input> so it sits flush with the text fields.
            'w-full justify-start border-input bg-transparent px-2.5 text-base font-normal tabular-nums md:text-sm dark:bg-input/30',
            !selected && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarDays aria-hidden="true" />
          {selected ? dayjs(selected).format('DD/MM/YYYY') : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={vi}
          captionLayout="dropdown"
          startMonth={new Date(THIS_YEAR - 10, 0)}
          endMonth={new Date(THIS_YEAR + 10, 11)}
          selected={selected}
          defaultMonth={selected}
          disabled={[
            ...(min ? [{ before: dayjs(min).toDate() }] : []),
            ...(max ? [{ after: dayjs(max).toDate() }] : []),
          ]}
          onSelect={(date) => {
            onChange(date ? dayjs(date).format(ISO_DATE) : '')
            setOpen(false)
          }}
          autoFocus
        />
        <div className="flex justify-between gap-2 border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(dayjs().format(ISO_DATE))
              setOpen(false)
            }}
          >
            Hôm nay
          </Button>
          {clearable && value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              Bỏ chọn
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, h) => pad(h))
const MINUTES = Array.from({ length: 12 }, (_, i) => pad(i * 5))

/** 24-hour HH:mm as an hour select and a minute select (5-minute steps). */
export function TimePicker({
  id,
  value,
  onChange,
  disabled,
  invalid,
  label = 'Giờ',
}: {
  /** Goes on the hour select, for the field's <label htmlFor>. */
  id?: string
  /** HH:mm (seconds ignored), or '' for none. */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  invalid?: boolean
  /** Names the two selects for screen readers: "{label} (giờ)" / "(phút)". */
  label?: string
}) {
  const [hour = '', minute = ''] = value ? value.split(':') : []
  // A saved minute off the 5-minute grid stays selectable.
  const minutes = minute && !MINUTES.includes(minute) ? [...MINUTES, minute].sort() : MINUTES
  const set = (h: string, m: string) => onChange(`${h || '00'}:${m || '00'}`)

  return (
    <div className="flex items-center gap-1.5">
      <Select value={hour} onValueChange={(h) => set(h, minute)} disabled={disabled}>
        <SelectTrigger id={id} aria-invalid={invalid} aria-label={`${label} (giờ)`} className="w-full tabular-nums">
          <SelectValue placeholder="Giờ" />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-64">
          {HOURS.map((h) => (
            <SelectItem key={h} value={h} className="tabular-nums">
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span aria-hidden="true" className="font-medium">
        :
      </span>
      <Select value={minute} onValueChange={(m) => set(hour, m)} disabled={disabled}>
        <SelectTrigger aria-invalid={invalid} aria-label={`${label} (phút)`} className="w-full tabular-nums">
          <SelectValue placeholder="Phút" />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-64">
          {minutes.map((m) => (
            <SelectItem key={m} value={m} className="tabular-nums">
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
