import { useSearchParams } from 'react-router'
import { patchParams } from './useListParams'
import { usePreference } from './usePreference'

export type ViewMode = 'table' | 'grid'
const MODES = ['table', 'grid'] as const

/**
 * Table/grid switch for one page. The user's last choice on that page is
 * remembered (per browser) and becomes their default. A `?view=` in the URL
 * — e.g. a "Xem phòng lạnh" link that opens the grid — wins for that visit;
 * switching clears it, so the URL never contradicts the saved choice.
 */
export function useViewMode(page: string) {
  const [params, setParams] = useSearchParams()
  const [saved, setSaved] = usePreference<ViewMode>(`view:${page}`, 'table', MODES)
  const fromUrl = params.get('view')
  const mode: ViewMode = fromUrl === 'grid' || fromUrl === 'table' ? fromUrl : saved

  const setMode = (next: ViewMode) => {
    setSaved(next)
    if (fromUrl !== null) {
      setParams((prev) => patchParams(prev, { view: null }), { replace: true })
    }
  }
  return [mode, setMode] as const
}
