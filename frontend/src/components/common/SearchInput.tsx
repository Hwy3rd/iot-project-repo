import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'

/**
 * Search box that reports the trimmed text after the user pauses typing
 * (or immediately on Enter / clear). `value` is the committed search, e.g.
 * from the URL; the box resyncs when it changes from outside.
 */
export function SearchInput({
  value,
  onSearch,
  placeholder = 'Tìm kiếm…',
  label = 'Tìm kiếm',
  delay = 350,
  className,
}: {
  value: string
  onSearch: (q: string) => void
  placeholder?: string
  label?: string
  delay?: number
  className?: string
}) {
  const [text, setText] = useState(value)
  const [committed, setCommitted] = useState(value)
  if (value !== committed) {
    setCommitted(value)
    setText(value)
  }

  useEffect(() => {
    if (text.trim() === value) return
    const t = setTimeout(() => onSearch(text.trim()), delay)
    return () => clearTimeout(t)
  }, [text, value, onSearch, delay])

  return (
    <div role="search" className={cn('relative w-full', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSearch(text.trim())
          if (e.key === 'Escape' && text) {
            e.preventDefault()
            setText('')
            onSearch('')
          }
        }}
        className="h-9 pr-9 pl-8"
      />
      {text && (
        <button
          type="button"
          aria-label="Xoá tìm kiếm"
          onClick={() => {
            setText('')
            onSearch('')
          }}
          className="absolute top-1/2 right-1 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
