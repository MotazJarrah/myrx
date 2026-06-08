import { createContext, useContext, useEffect } from 'react'

// Theme switching was removed (Jun 8 2026). The app is dark-only across every
// surface (web + mobile) for consistency — mobile has no light palette, so
// rather than ship light mode on one surface and not the other, light/dark was
// dropped entirely. This provider now just locks the document to dark and clears
// any stale 'light' preference left in localStorage from before the toggle
// existed. `useTheme()` still returns { theme: 'dark' } so the handful of
// read-only consumers (Landing, Navbar, legal/marketing logo variants) keep
// working unchanged.
const ThemeContext = createContext({ theme: 'dark' })

export function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.classList.add('dark')
    try { localStorage.removeItem('theme') } catch { /* ignore */ }
  }, [])

  return <ThemeContext.Provider value={{ theme: 'dark' }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext) ?? { theme: 'dark' }
