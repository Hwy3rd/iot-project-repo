import type { ColdRoom, ColdRoomStatus } from '@/api/types'
import { Button } from '@/components/ui/button'
import { formatNumber, formatTemp } from '@/lib/format'
import { TEMP_STATE, tempState, type TempState } from '@/lib/room-status'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, DoorOpen, LayoutGrid } from 'lucide-react'
import { useEffect, useRef } from 'react'

const ACCENT: Record<TempState, string> = {
  ok: 'border-l-success',
  out: 'border-l-destructive',
  fault: 'border-l-destructive',
  stale: 'border-l-warning',
  none: 'border-l-border',
}

const TEMP_TEXT: Record<TempState, string> = {
  ok: 'text-foreground',
  out: 'text-destructive',
  fault: 'text-destructive',
  stale: 'text-muted-foreground',
  none: 'text-muted-foreground',
}

/**
 * Compact strip of every room of the warehouse while one is open: each chip
 * keeps the room's state readable at a glance (colour, temperature, open
 * door, open alerts) so problems elsewhere aren't missed, and switches to it
 * in one click. Prev/next step through rooms in board order.
 */
export function RoomSwitcher({
  rooms,
  statusByRoom,
  selectedId,
  now,
  onSelect,
  onShowAll,
}: {
  rooms: ColdRoom[]
  statusByRoom: Map<string, ColdRoomStatus>
  selectedId: string
  now: number
  onSelect: (id: string) => void
  onShowAll: () => void
}) {
  const index = rooms.findIndex((r) => r.id === selectedId)
  const prev = index > 0 ? rooms[index - 1] : undefined
  const next = index >= 0 && index < rooms.length - 1 ? rooms[index + 1] : undefined

  // Keep the open room's chip centred in the strip when switching. Scrolls
  // the strip only — scrollIntoView would also move the page vertically.
  const listRef = useRef<HTMLUListElement>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const list = listRef.current
    const chip = selectedRef.current
    if (!list || !chip) return
    const left = chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2
    list.scrollTo({ left: Math.max(0, left), behavior: 'smooth' })
  }, [selectedId])

  return (
    <nav aria-label="Chuyển phòng lạnh" className="flex items-stretch gap-2">
      {/* Icon-only on phones, so the strip keeps room for the chips. */}
      <Button
        variant="outline"
        className="h-auto shrink-0 flex-col gap-0.5 px-2.5 py-2 sm:px-3"
        onClick={onShowAll}
        title="Tất cả phòng"
      >
        <LayoutGrid aria-hidden="true" />
        <span className="text-xs max-sm:sr-only">Tất cả phòng</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-auto shrink-0 max-sm:hidden"
        disabled={!prev}
        onClick={() => prev && onSelect(prev.id)}
        aria-label={prev ? `Phòng trước: ${prev.name}` : 'Không có phòng trước'}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <ul ref={listRef} className="relative flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {rooms.map((room) => {
          const status = statusByRoom.get(room.id)
          const latest = status?.latest ?? null
          const state = tempState(latest, now)
          const selected = room.id === selectedId
          const alerts = status?.activeAlerts ?? 0
          return (
            <li key={room.id} className="shrink-0">
              <button
                ref={selected ? selectedRef : undefined}
                type="button"
                onClick={() => onSelect(room.id)}
                aria-current={selected ? 'page' : undefined}
                title={`${room.name}: ${TEMP_STATE[state].label}`}
                className={cn(
                  'flex h-full w-36 flex-col gap-0.5 rounded-lg border border-l-4 bg-card px-2.5 py-1.5 text-left transition-colors',
                  'hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                  ACCENT[state],
                  selected && 'bg-primary/8 ring-2 ring-primary/60 hover:bg-primary/10',
                )}
              >
                <span className={cn('truncate text-sm', selected ? 'font-semibold' : 'font-medium')}>{room.name}</span>
                <span className="flex items-center gap-1.5 text-sm">
                  <span className={cn('font-semibold tabular-nums', TEMP_TEXT[state])}>
                    {latest?.temperature != null ? formatTemp(latest.temperature) : TEMP_STATE[state].label}
                  </span>
                  {latest?.doorOpen && (
                    <DoorOpen className="size-3.5 text-warning" aria-label="Cửa đang mở" />
                  )}
                  {alerts > 0 && (
                    <span
                      className="ml-auto rounded-full bg-destructive px-1.5 text-xs font-semibold text-white tabular-nums"
                      aria-label={`${formatNumber(alerts)} cảnh báo chưa xử lý`}
                    >
                      {formatNumber(alerts)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <Button
        variant="ghost"
        size="icon"
        className="h-auto shrink-0 max-sm:hidden"
        disabled={!next}
        onClick={() => next && onSelect(next.id)}
        aria-label={next ? `Phòng sau: ${next.name}` : 'Không có phòng sau'}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  )
}
