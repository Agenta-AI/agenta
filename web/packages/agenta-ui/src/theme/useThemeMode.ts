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
    // The OS preference is STATE, not a render-time read of `matchMedia`. Reading it during
    // render made the `change` listener inert: its only job was `setThemeMode("system")` while
    // the mode already WAS "system", React bailed out on Object.is, nothing re-rendered, and
    // `resolved` never recomputed. Held here, a `change` event is a real state transition.
    // Starts `false` on both sides of hydration for the same reason `themeMode` starts
    // "system": the boot script has already painted the right class, and reading the media
    // query during the first client render would diverge from the server's.
    const [systemPrefersDark, setSystemPrefersDark] = useState(false)

    // Read after mount: the value is client-only, and the boot script has already applied the
    // class, so hydrating from it here would mismatch the server render.
    useEffect(() => setThemeMode(read()), [])

    const resolved: "light" | "dark" =
        themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode

    useEffect(() => {
        if (typeof document === "undefined") return
        const root = document.documentElement
        root.classList.toggle("dark", resolved === "dark")
        root.style.colorScheme = resolved
    }, [resolved])

    // Follow the OS — otherwise the page only flips on reload. Subscribed unconditionally, not
    // only while the choice is "system", so switching back to "system" resolves against a
    // current value rather than whatever the OS said when the listener was last attached.
    useEffect(() => {
        if (typeof window === "undefined") return
        const query = window.matchMedia?.(DARK_QUERY)
        if (!query) return
        setSystemPrefersDark(query.matches)
        const sync = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
        query.addEventListener("change", sync)
        return () => query.removeEventListener("change", sync)
    }, [])

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
