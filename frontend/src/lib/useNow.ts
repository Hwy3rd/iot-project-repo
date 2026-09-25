import { useEffect, useState } from 'react'

/**
 * The current time, re-rendering every `everyMs`. For states derived from
 * the clock — e.g. a reading turning "stale" when no new sample arrives.
 */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}
