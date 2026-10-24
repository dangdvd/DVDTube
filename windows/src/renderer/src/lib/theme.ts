// Applies the theme setting to <html data-theme> (following the OS for "Theo hệ thống") and a
// small media-query hook for the responsive layout.

import { useEffect, useState } from 'react'
import { useSettings } from '@/state/settings'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export function useTheme(): void {
  const theme = useSettings((s) => s.settings.theme)
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  useEffect(() => {
    const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
    document.documentElement.dataset.theme = resolved
  }, [theme, systemDark])
}
