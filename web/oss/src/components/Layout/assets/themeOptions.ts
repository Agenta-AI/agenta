import {THEME_OPTIONS as SHARED_THEME_OPTIONS} from "@agenta/ui/theme"

import {ThemeMode} from "@/oss/components/Layout/ThemeContextProvider"

export interface ThemeOption {
    mode: ThemeMode
    /** Full label for menus. */
    label: string
    /** Compact label for inline / current-value display. */
    short: string
}

/**
 * Single source of truth for theme choices (Preferences tab + sidebar fly-out); light first.
 *
 * The list itself is shared with mobile in `@agenta/ui/theme`. Only the typing differs: this app
 * carries a `ThemeMode` enum whose members ARE those strings, and an enum-typed parameter will not
 * accept a raw one — so the shared list is re-typed here rather than copied.
 */
export const THEME_OPTIONS = SHARED_THEME_OPTIONS as ThemeOption[]
