import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
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
 * switcher's fly-out and the Preferences tab. Light first.
 */
export const THEME_OPTIONS: ThemeOption[] = [
    {mode: "light", label: "Light", short: "Light"},
    {mode: "dark", label: "Dark", short: "Dark"},
    {mode: "system", label: "System default", short: "System"},
]

/** The same options with the labels in the chosen language. */
export const useThemeOptions = (): ThemeOption[] => {
    const t = useT(commonCatalog)
    return useMemo(
        () => [
            {mode: "light", label: t("common.light"), short: t("common.light")},
            {mode: "dark", label: t("common.dark"), short: t("common.dark")},
            {mode: "system", label: t("common.systemDefault"), short: t("common.system")},
        ],
        [t],
    )
}

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
