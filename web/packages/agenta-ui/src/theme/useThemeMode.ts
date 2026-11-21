import {useCallback, useEffect, useLayoutEffect, useState} from "react"

export type ThemeModeValue = "light" | "dark" | "system"

/** Shared with the boot script in each app's document, which reads the same key. */
export const THEME_STORAGE_KEY = "agenta-theme"

/** usehooks-ts JSON-encodes its values; the desktop wrote this key that way first. */
const read = (): ThemeModeValue => {
    if (typeof window === "undefined") return "system"
    try {
        const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
        if (!raw) return "system"
        const value = raw.charAt(0) === '"' ? (JSON.parse(raw) as string) : raw
        return value === "light" || value === "dark" ? value : "system"
    } catch {
        return "system"
    }
}

const DARK_QUERY = "(prefers-color-scheme: dark)"

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

/**
 * THE theme-mode controller: the stored preference, the theme it resolves to, and the `.dark`
 * class that carries it.
 *
 * Extracted from the desktop's ThemeContextProvider, which additionally configures antd — that
 * part stays there. Everything here is what both apps need, keyed off the same storage entry so
 * a viewer's choice follows them between the desktop and /m.
 */
export const useThemeMode = () => {
    const [themeMode, setThemeMode] = useState<ThemeModeValue>("system")
    const [systemDark, setSystemDark] = useState(false)
    const [hydrated, setHydrated] = useState(false)

    // Client-only read after mount, in a layout effect so the mode lands before first paint.
    useIsomorphicLayoutEffect(() => {
        setThemeMode(read())
        if (window.matchMedia) setSystemDark(window.matchMedia(DARK_QUERY).matches)
        setHydrated(true)
    }, [])

    // The OS preference is STATE, not a render-time `matchMedia` read: re-setting the mode to
    // "system" on a change is a no-op write React bails out of, so the page only flipped on
    // reload. Listening unconditionally also makes switching back to "system" resolve at once.
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return
        const query = window.matchMedia(DARK_QUERY)
        const sync = (event: MediaQueryListEvent) => setSystemDark(event.matches)
        query.addEventListener("change", sync)
        return () => query.removeEventListener("change", sync)
    }, [])

    const resolved: "light" | "dark" =
        themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode

    // Until the stored mode is read, the boot script's class is the truth; do not touch it.
    useEffect(() => {
        if (typeof document === "undefined" || !hydrated) return
        const root = document.documentElement
        root.classList.toggle("dark", resolved === "dark")
        root.style.colorScheme = resolved
    }, [hydrated, resolved])

    const setMode = useCallback((next: ThemeModeValue) => {
        setThemeMode(next)
        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(next))
        } catch {
            /* private mode — the choice just does not persist */
        }
    }, [])

    return {themeMode, resolved, setMode}
}
