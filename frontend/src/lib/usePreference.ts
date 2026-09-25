import { useCallback, useSyncExternalStore } from 'react'

// Per-browser UI preferences in localStorage (not synced across devices).
// Storage can be unavailable (private mode, blocked site data): reads then
// fall back to the default and writes are dropped, never throwing.

const PREFIX = 'pref:'
const listeners = new Set<() => void>()

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  // Another tab changed a preference.
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** A remembered choice among `allowed`; anything else stored reads as `fallback`. */
export function usePreference<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  )
  const value = allowed.includes(raw as T) ? (raw as T) : fallback

  const setValue = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(PREFIX + key, next)
      } catch {
        // Not persisted; the current view still switches via the caller.
      }
      listeners.forEach((l) => l())
    },
    [key],
  )

  return [value, setValue] as const
}
