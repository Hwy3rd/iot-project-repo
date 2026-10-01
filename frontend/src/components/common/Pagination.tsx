import type { PageMeta } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatNumber } from '@/lib/format'
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, patchParams } from '@/lib/useListParams'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'

/** Page numbers to show: first, last, and a window around the current page; null = gap. */
function pageWindow(current: number, total: number, radius = 1): (number | null)[] {
  const pages = new Set([1, total])
  for (let p = current - radius; p <= current + radius; p++) {
    if (p > 1 && p < total) pages.add(p)
  }
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: (number | null)[] = []
  sorted.forEach((p, i) => {
    const gap = p - (sorted[i - 1] ?? p)
    // A gap of exactly one page is cheaper to show than an ellipsis.
    if (gap === 2) out.push(p - 1)
    else if (gap > 2) out.push(null)
    out.push(p)
  })
  return out
}

function PageLink({
  page,
  disabled,
  current,
  label,
  className,
  children,
}: {
  page: number
  disabled?: boolean
  current?: boolean
  label: string
  className?: string
  children: ReactNode
}) {
  const [params] = useSearchParams()
  const variant = current ? 'default' : 'outline'
  if (disabled || current) {
    return (
      <Button
        variant={variant}
        size="icon"
        disabled={disabled}
        aria-label={label}
        aria-current={current ? 'page' : undefined}
        className={cn('tabular-nums', className)}
        tabIndex={current ? -1 : undefined}
      >
        {children}
      </Button>
    )
  }
  return (
    <Button variant={variant} size="icon" className={cn('tabular-nums', className)} asChild>
      <Link to={{ search: patchParams(params, { page: page > 1 ? page : null }).toString() }} aria-label={label}>
        {children}
      </Link>
    </Button>
  )
}

function JumpToPage({ totalPages }: { totalPages: number }) {
  const [, setParams] = useSearchParams()
  const [value, setValue] = useState('')

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const n = Math.min(Math.max(Math.trunc(Number(value)), 1), totalPages)
    if (Number.isFinite(n)) setParams((prev) => patchParams(prev, { page: n > 1 ? n : null }))
    setValue('')
  }

  return (
    <form onSubmit={onSubmit} className="ml-2 hidden items-center gap-2 2xl:flex">
      <label htmlFor="jump-page" className="whitespace-nowrap">
        Đến trang
      </label>
      <Input
        id="jump-page"
        type="number"
        inputMode="numeric"
        min={1}
        max={totalPages}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 w-16 tabular-nums"
      />
    </form>
  )
}

function PageSizeSelect({ limit }: { limit: number }) {
  const [, setParams] = useSearchParams()
  return (
    <div className="flex items-center gap-2">
      <span id="page-size-label" className="whitespace-nowrap">
        Số dòng
      </span>
      <Select
        value={String(limit)}
        onValueChange={(v) =>
          setParams((prev) =>
            patchParams(prev, { limit: Number(v) === DEFAULT_PAGE_SIZE ? null : v, page: null }),
          )
        }
      >
        <SelectTrigger aria-labelledby="page-size-label" className="w-18 tabular-nums">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZES.map((s) => (
            <SelectItem key={s} value={String(s)} className="tabular-nums">
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** URL-driven pagination: writes ?page and ?limit (read them with useListParams). */
export function Pagination({ meta }: { meta: PageMeta }) {
  if (meta.total === 0) return null
  const totalPages = Math.max(meta.totalPages, 1)
  const page = Math.min(meta.page, totalPages)
  const from = (meta.page - 1) * meta.limit + 1
  const to = Math.min(meta.page * meta.limit, meta.total)

  return (
    <nav
      aria-label="Phân trang"
      className="flex flex-wrap gap-3 border-t-2 bg-muted px-4 py-3 text-muted-foreground items-center justify-between"
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-3 xl:w-auto xl:justify-start">
        <p className="tabular-nums">
          {from > meta.total ? '0' : `${formatNumber(from)}–${formatNumber(to)}`} /{' '}
          {formatNumber(meta.total)}
        </p>
        <PageSizeSelect limit={meta.limit} />
      </div>

      <div className="flex w-full flex-wrap items-center justify-between gap-1 xl:w-auto xl:justify-end">
        <PageLink page={1} disabled={page <= 1} label="Trang đầu">
          <ChevronsLeft aria-hidden="true" />
        </PageLink>
        <PageLink page={page - 1} disabled={page <= 1} label="Trang trước">
          <ChevronLeft aria-hidden="true" />
        </PageLink>

        <span className="min-w-0 text-center tabular-nums xl:hidden">
          Trang {formatNumber(page)}/{formatNumber(totalPages)}
        </span>
        <ul className="hidden items-center gap-1 xl:flex">
          {pageWindow(page, totalPages).map((p, i) => (
            <li key={p ?? `gap-${i}`}>
              {p === null ? (
                <span className="grid w-6 place-items-center" aria-hidden="true">
                  …
                </span>
              ) : (
                <PageLink page={p} current={p === page} label={`Trang ${p}`} className="w-auto min-w-8 px-2">
                  {formatNumber(p)}
                </PageLink>
              )}
            </li>
          ))}
        </ul>

        <PageLink page={page + 1} disabled={page >= totalPages} label="Trang sau">
          <ChevronRight aria-hidden="true" />
        </PageLink>
        <PageLink page={totalPages} disabled={page >= totalPages} label="Trang cuối">
          <ChevronsRight aria-hidden="true" />
        </PageLink>
        {totalPages > 5 && <JumpToPage totalPages={totalPages} />}
      </div>
    </nav>
  )
}
