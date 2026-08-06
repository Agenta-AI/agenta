import {ThemeMode} from "@/oss/components/Layout/ThemeContextProvider"

export interface ThemeOption {
    mode: ThemeMode
    /** Full label for menus. */
    label: string
    /** Compact label for inline / current-value display. */
    short: string
}

// Single source of truth for theme choices (Preferences tab + sidebar fly-out); light first.
export const THEME_OPTIONS: ThemeOption[] = [
    {mode: ThemeMode.Light, label: "Light", short: "Light"},
    {mode: ThemeMode.Dark, label: "Dark", short: "Dark"},
    {mode: ThemeMode.System, label: "System default", short: "System"},
]
