import { cn } from '@/lib/utils'

/** Whether the realtime socket is delivering updates right now. */
export function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap text-muted-foreground"
      title={
        live
          ? 'Nhiệt độ và cảnh báo được cập nhật ngay khi có dữ liệu mới.'
          : 'Mất kết nối trực tiếp; đang tự làm mới định kỳ và thử kết nối lại.'
      }
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className={cn('size-2 rounded-full', live ? 'animate-pulse bg-success' : 'bg-warning')}
      />
      {live ? 'Trực tiếp' : 'Đang kết nối lại…'}
    </span>
  )
}
