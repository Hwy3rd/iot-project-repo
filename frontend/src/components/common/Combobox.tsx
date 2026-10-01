import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { Command } from 'cmdk'
import { CheckIcon, ChevronDownIcon, SearchIcon } from 'lucide-react'
import { useState } from 'react'

export interface ComboboxOption {
  value: string
  label: string
  /** Muted text after the label, e.g. the account role. Also searchable. */
  hint?: string
}

/** Short lists stay a plain pick list; longer ones get a search box. */
const SEARCH_MIN_OPTIONS = 8

/** "Dũng" should match "dung", and "đ" match "d". */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()

// cmdk ranks with its own fuzzy scorer; a plain substring match over the
// label and hint is more predictable for names and usernames.
function filter(_value: string, search: string, keywords?: string[]) {
  const needle = fold(search.trim())
  if (!needle) return 1
  return keywords?.some((k) => fold(k).includes(needle)) ? 1 : 0
}

/**
 * Select look-alike for long option lists (e.g. picking a user): opens a
 * pick list that can be narrowed by typing once it has enough options.
 */
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder = 'Chọn…',
  searchPlaceholder = 'Tìm…',
  emptyText = 'Không có kết quả phù hợp.',
  disabled,
  className,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((o) => o.value === value)
  const searchable = options.length >= SEARCH_MIN_OPTIONS

  return (
    // Modal: the list is portaled out of any surrounding Dialog, whose scroll
    // lock would otherwise swallow wheel/touch scrolling over it.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-placeholder={selected ? undefined : ''}
          className={cn(
            // Matches SelectTrigger (components/ui/select).
            'flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-left text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50',
            className,
          )}
        >
          <span className="line-clamp-1 min-w-0">
            {selected ? (
              <>
                {selected.label}
                {selected.hint && <span className="text-muted-foreground"> · {selected.hint}</span>}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-0 max-w-[calc(100vw-2rem)] gap-0 p-0"
      >
        <Command filter={filter} loop>
          {searchable && (
            <div className="flex items-center gap-2 border-b px-2.5">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Command.Input
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          )}
          <Command.List className="max-h-64 overflow-y-auto overscroll-contain p-1">
            <Command.Empty className="py-6 text-center text-muted-foreground">{emptyText}</Command.Empty>
            {options.map((o) => (
              <Command.Item
                key={o.value}
                value={o.value}
                keywords={o.hint ? [o.label, o.hint] : [o.label]}
                onSelect={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className="relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 outline-none select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
              >
                <span className="min-w-0 break-words">
                  {o.label}
                  {o.hint && <span className="text-muted-foreground"> · {o.hint}</span>}
                </span>
                {o.value === value && (
                  <CheckIcon className="absolute right-2 size-4" aria-hidden="true" />
                )}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
