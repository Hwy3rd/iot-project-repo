import { ToneBadge } from '@/components/common/StatusBadge'
import { formatMinutes } from '@/lib/format'

/** Warning badge when a check-in was late; "Đúng giờ" only when asked to show it. */
export function LateBadge({ minutes, showOnTime = false }: { minutes: number | null; showOnTime?: boolean }) {
  if (minutes === null) return null
  if (minutes > 0) return <ToneBadge tone="warning">Trễ {formatMinutes(minutes)}</ToneBadge>
  return showOnTime ? <ToneBadge tone="success">Đúng giờ</ToneBadge> : null
}
