import {PropsWithChildren, createContext, useContext, useCallback, useEffect, useMemo} from "react"

import {useThemeMode} from "@agenta/ui/theme"
import {ConfigProvider, theme} from "antd"
import {Inter} from "next/font/google"

import {DARK_TOKEN_OVERRIDES, darkComponents} from "@/oss/styles/theme/antd-overrides.generated"
import antdTokens from "@/oss/styles/tokens/antd-themeConfig.json"
// GENERATED from the theme source of truth (styles/theme/palette.ts) by
// scripts/generate-tailwind-tokens.ts. Edit palette.ts + regenerate, not this.

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
})

const getPopupContainer = (triggerNode?: HTMLElement) =>
    (triggerNode?.closest(
        '[data-slot="sheet-content"], [data-slot="dialog-content"]',
    ) as HTMLElement | null) ?? document.body

export enum ThemeMode {
    Light = "light",
    Dark = "dark",
    System = "system",
}
type ThemeType = ThemeMode.Light | ThemeMode.Dark
type ThemeModeType = `${ThemeMode}`

export const ThemeContext = createContext<{
    appTheme: ThemeType
    themeMode: ThemeMode
    toggleAppTheme: (themeName: ThemeModeType) => void
}>({
    appTheme: ThemeMode.Light,
    themeMode: ThemeMode.Light,
    toggleAppTheme: () => {},
})

export const useAppTheme = () => useContext(ThemeContext)

export const getDeviceTheme = () => {
    return typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
        ? ThemeMode.Dark
        : ThemeMode.Light
}

const isColorValue = (val: unknown): boolean =>
    typeof val === "string" && /^(#|rgba?\(|hsla?\()/.test(val.trim())

// Drop entries whose value is a color string, keeping structural tokens (radii,
// heights, font sizes, durations). In dark mode the light color overrides from
// antd-themeConfig.json must not leak in — darkAlgorithm computes colors instead —
// but the structural design tokens should still apply.
const stripColors = <T extends Record<string, unknown>>(obj: T): Partial<T> =>
    Object.fromEntries(Object.entries(obj).filter(([, val]) => !isColorValue(val))) as Partial<T>

// Same as stripColors but for the per-component override map
// ({ Tag: {...}, Tabs: {...}, ... }): strip colors inside each component's token
// object while keeping its structural overrides (fontSizeSM, lineHeight, padding,
// radii). Without this, dark mode loses every component-level sizing override and
// falls back to the derived globals — e.g. Tag renders at fontSizeSM 10 instead of
// the configured 12, so tags (and Tabs/Select/Badge/...) shrink vs. light mode.
const stripComponentColors = <T extends Record<string, Record<string, unknown>>>(
    components: T,
): Record<string, Record<string, unknown>> =>
    Object.fromEntries(
        Object.entries(components).map(([name, tokens]) => [name, stripColors(tokens)]),
    )

// DARK_TOKEN_OVERRIDES + darkComponents are GENERATED from styles/theme/palette.ts
// (imported above). They are the seed/override inputs to antd's darkAlgorithm; the
// algorithm derives the rest and the --ag-* CSS layer aliases the output. To tune the
// dark palette, edit palette.ts and run `pnpm generate:tailwind-tokens`. The per-token
// rationale for each override lives in git history for this file (pre-wiring).

const ThemeContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    // The stored preference, the theme it resolves to, the OS listener and the `.dark` class
    // all live in @agenta/ui/theme, so this app and /m read and write one contract. What stays
    // here is the part only this app has: antd's ConfigProvider and its cssVar key class.
    const {themeMode, resolved, setMode} = useThemeMode()
    const appTheme: ThemeType = resolved === "dark" ? ThemeMode.Dark : ThemeMode.Light

    // antd's cssVar key class (`agenta`) makes the global `--ant-*` design-token variables
    // (emitted by ConfigProvider's `cssVar: {key: "agenta"}` under the `.agenta` selector)
    // resolve everywhere — including plain elements outside antd component subtrees, so
    // Tailwind/CSS can alias them.
    useEffect(() => {
        document.documentElement.classList.add("agenta")
    }, [])

    const isDark = appTheme === ThemeMode.Dark

    const themeConfig = useMemo(() => {
        const baseToken = {
            fontFamily: inter.style.fontFamily,
            fontFamilyCode: inter.style.fontFamily,
        }

        if (isDark) {
            return {
                algorithm: theme.darkAlgorithm,
                cssVar: {key: "agenta"},
                token: {
                    ...baseToken,
                    ...stripColors(antdTokens.token),
                    // Mirror light mode's component overrides (spread into token) so
                    // structural sizing matches across themes; colors are stripped per
                    // component so darkAlgorithm still owns dark colors.
                    ...stripComponentColors(antdTokens.components),
                    ...DARK_TOKEN_OVERRIDES,
                },
                components: darkComponents,
            }
        }

        // Light mode preserved exactly as before: token + (inert) component config
        // are both spread into `token`, matching the prior ConfigProvider shape.
        return {
            algorithm: theme.defaultAlgorithm,
            cssVar: {key: "agenta"},
            token: {
                ...baseToken,
                ...antdTokens.token,
                ...antdTokens.components,
            },
        }
    }, [isDark])

    const toggleAppTheme = useCallback((themeType: ThemeModeType) => setMode(themeType), [setMode])

    // Stable value so useAppTheme consumers only re-render on actual theme changes
    const contextValue = useMemo(
        () => ({appTheme, toggleAppTheme, themeMode: themeMode as ThemeMode}),
        [appTheme, toggleAppTheme, themeMode],
    )

    return (
        <ThemeContext.Provider value={contextValue}>
            <ConfigProvider theme={themeConfig} getPopupContainer={getPopupContainer}>
                {children}
            </ConfigProvider>
        </ThemeContext.Provider>
    )
}

export default ThemeContextProvider
