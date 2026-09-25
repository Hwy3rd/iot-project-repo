import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { errorText } from '@/lib/errors'
import { CircleAlert, Inbox, Loader2, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'

export function Spinner({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function FullPageSpinner() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner />
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-pretty text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="p-4">
      <Alert variant="destructive">
        <CircleAlert aria-hidden="true" />
        <AlertTitle>Không tải được dữ liệu</AlertTitle>
        <AlertDescription>
          <p>{errorText(error)}</p>
          {onRetry && (
            <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
              <RotateCw aria-hidden="true" />
              Thử lại
            </Button>
          )}
        </AlertDescription>
      </Alert>
    </div>
  )
}
