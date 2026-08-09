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

const prefersDark = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches === true

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

    // Read after mount: the value is client-only, and the boot script has already applied the
    // class, so hydrating from it here would mismatch the server render.
    useEffect(() => setThemeMode(read()), [])

    const resolved: "light" | "dark" =
        themeMode === "system" ? (prefersDark() ? "dark" : "light") : themeMode

    useEffect(() => {
        if (typeof document === "undefined") return
        const root = document.documentElement
        root.classList.toggle("dark", resolved === "dark")
        root.style.colorScheme = resolved
    }, [resolved])

    // Follow the OS while the choice is "system" — otherwise the page only flips on reload.
    useEffect(() => {
        if (themeMode !== "system" || typeof window === "undefined") return
        const query = window.matchMedia("(prefers-color-scheme: dark)")
        const sync = () => setThemeMode("system")
        query.addEventListener("change", sync)
        return () => query.removeEventListener("change", sync)
    }, [themeMode])

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
