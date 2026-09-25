import { useTheme } from 'next-themes'
import { useEffect } from 'react'

const THEME_COLOR = { light: '#f8fafc', dark: '#11151c' } as const

/** Keeps <meta name="theme-color"> (browser chrome) in step with the active theme. */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    const color = resolvedTheme === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
      m.content = color
    })
  }, [resolvedTheme])
  return null
}
