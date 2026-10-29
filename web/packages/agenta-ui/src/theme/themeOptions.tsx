import {Desktop, Moon, Sun} from "@phosphor-icons/react"

import type {ThemeModeValue} from "./useThemeMode"

export interface ThemeOption {
    mode: ThemeModeValue
    /** Full label for menus. */
    label: string
    /** Compact label for inline / current-value display. */
    short: string
}

/**
 * Single source of truth for the theme choices, wherever they are offered — the sidebar
 * switcher's fly-out and the Preferences tab, on the desktop and on mobile. Light first.
 *
 * It lives here rather than in either app because both offer the same three, and three copies of
 * a three-item list is how they drift: mobile's was missing `short`, so it could not render the
 * switcher's current-value row at all.
 */
export const THEME_OPTIONS: ThemeOption[] = [
    {mode: "light", label: "Light", short: "Light"},
    {mode: "dark", label: "Dark", short: "Dark"},
    {mode: "system", label: "System default", short: "System"},
]

/** The glyph for a mode, so every surface labels the same choice with the same icon. */
export const themeIcon = (mode: ThemeModeValue, size = 14) => {
    switch (mode) {
        case "dark":
            return <Moon size={size} className="shrink-0" />
        case "system":
            return <Desktop size={size} className="shrink-0" />
        default:
            return <Sun size={size} className="shrink-0" />
    }
}
