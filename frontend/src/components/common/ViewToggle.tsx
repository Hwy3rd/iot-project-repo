import { Button } from '@/components/ui/button'
import type { ViewMode } from '@/lib/useViewMode'
import { LayoutGrid, Rows3 } from 'lucide-react'

const OPTIONS = [
  { value: 'table', label: 'Bảng', icon: Rows3 },
  { value: 'grid', label: 'Lưới', icon: LayoutGrid },
] as const

export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  return (
    <div role="group" aria-label="Kiểu hiển thị" className="flex rounded-lg border bg-muted p-0.5">
      {OPTIONS.map(({ value: mode, label, icon: Icon }) => (
        <Button
          key={mode}
          type="button"
          variant={value === mode ? 'outline' : 'ghost'}
          size="sm"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={value === mode ? 'bg-card shadow-xs' : 'text-muted-foreground'}
        >
          <Icon aria-hidden="true" />
          {label}
        </Button>
      ))}
    </div>
  )
}
