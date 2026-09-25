import { dayjs } from '@/lib/format'

/** "Cập nhật lúc 14:03:05" for data that refreshes on an interval. */
export function LastUpdated({
  at,
  fetching,
  everySeconds,
}: {
  /** TanStack Query's dataUpdatedAt (0 = never loaded). */
  at: number
  fetching: boolean
  everySeconds: number
}) {
  if (!at) return null
  return (
    <span
      className="text-sm whitespace-nowrap text-muted-foreground tabular-nums"
      title={`Tự làm mới mỗi ${everySeconds} giây`}
      aria-live="polite"
    >
      {fetching ? 'Đang cập nhật…' : `Cập nhật lúc ${dayjs(at).format('HH:mm:ss')}`}
    </span>
  )
}
