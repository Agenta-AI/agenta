import {useCallback, useEffect, useState} from "react"

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

    // Read after mount: the value is client-only, and the boot script has already applied the
    // class, so hydrating from it here would mismatch the server render.
    useEffect(() => setThemeMode(read()), [])

    // The OS preference is STATE, not a render-time `matchMedia` read: re-setting the mode to
    // "system" on a change is a no-op write React bails out of, so the page only flipped on
    // reload. Listening unconditionally also makes switching back to "system" resolve at once.
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return
        const query = window.matchMedia(DARK_QUERY)
        setSystemDark(query.matches)
        const sync = (event: MediaQueryListEvent) => setSystemDark(event.matches)
        query.addEventListener("change", sync)
        return () => query.removeEventListener("change", sync)
    }, [])

    const resolved: "light" | "dark" =
        themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode

    useEffect(() => {
        if (typeof document === "undefined") return
        const root = document.documentElement
        root.classList.toggle("dark", resolved === "dark")
        root.style.colorScheme = resolved
    }, [resolved])

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
