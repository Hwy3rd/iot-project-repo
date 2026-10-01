import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-full sm:basis-64">
        <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
        {description && <p className="mt-1.5 text-base text-pretty text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto [&>button]:max-sm:flex-1 [&>a]:max-sm:flex-1">{actions}</div>}
    </div>
  )
}
