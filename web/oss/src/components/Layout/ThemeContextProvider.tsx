import {PropsWithChildren, createContext, useState, useContext, useEffect, useMemo} from "react"

import {ConfigProvider, theme} from "antd"
import {Inter} from "next/font/google"
import {useLocalStorage} from "usehooks-ts"

import useLazyEffect from "@/oss/hooks/useLazyEffect"
import antdTokens from "@/oss/styles/tokens/antd-themeConfig.json"

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
})

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

const getAppTheme = (themeMode: ThemeMode): ThemeType =>
    themeMode === ThemeMode.System ? getDeviceTheme() : (themeMode as ThemeType)

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

// ============================================================================
// DARK THEME TUNING — single source of truth for the dark color schema.
//
// antd's `darkAlgorithm` computes the full dark token set; we only override the
// tokens below. Because cssVar mode is on (see themeConfig) and our Tailwind/CSS
// layer aliases antd's `--ant-*` tokens (see styles/theme-variables.css), editing
// a value here flows app-wide — antd components AND Tailwind/CSS/JSS colors.
//
// To fine-tune the dark palette, change or uncomment a token below. Light mode is
// unaffected (it uses antd-themeConfig.json + defaultAlgorithm).
// ============================================================================
const DARK_TOKEN_OVERRIDES = {
    // Brand accent — the light navy primary (#1c2c3d) is invisible on dark, so the
    // accent becomes the Agenta brand yellow (logo color).
    colorPrimary: "#f2f25c",
    colorSuccess: "#52c41a",
    colorWarning: "#faad14",
    colorError: "#ff4d4f",
    // Surfaces / text / border come from darkAlgorithm by default. Uncomment to tune:
    // colorBgContainer: "#141414",
    // colorBgElevated: "#1f1f1f",
    // colorBgLayout: "#000000",
    // colorText: "rgba(255, 255, 255, 0.85)",
    // colorBorder: "#424242",
}
// On a bright yellow primary, antd's default light-solid (#fff) label is unreadable —
// force dark text on primary-colored buttons in dark mode.
const darkComponents = {
    Button: {
        primaryColor: "#141414",
    },
}

const ThemeContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [themeMode, setThemeMode] = useLocalStorage<ThemeMode>("agenta-theme", ThemeMode.System)
    const [appTheme, setAppTheme] = useState<ThemeType>(getAppTheme(themeMode))

    useEffect(() => {
        const handleSystemThemeChange = ({matches}: MediaQueryListEvent) => {
            if (themeMode === ThemeMode.System) {
                setAppTheme(matches ? ThemeMode.Dark : ThemeMode.Light)
            }
        }

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
        mediaQuery.addEventListener("change", handleSystemThemeChange)

        return () => {
            mediaQuery.removeEventListener("change", handleSystemThemeChange)
        }
    }, [themeMode])

    useLazyEffect(() => {
        setAppTheme(getAppTheme(themeMode))
    }, [themeMode])

    // Toggle the `.dark` class on <html> so the CSS-variable token layer (and any
    // Tailwind `dark:` variants) reflect the active theme. Also add antd's cssVar
    // key class (`agenta`) so the global `--ant-*` design-token variables (emitted
    // by ConfigProvider's `cssVar: {key: "agenta"}` option under the `.agenta`
    // selector) resolve everywhere — including plain elements outside antd
    // component subtrees, so Tailwind/CSS can alias them.
    useEffect(() => {
        const root = document.documentElement
        root.classList.toggle("dark", appTheme === ThemeMode.Dark)
        root.classList.add("agenta")
        root.style.colorScheme = appTheme === ThemeMode.Dark ? "dark" : "light"
    }, [appTheme])

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

    return (
        <ThemeContext.Provider
            value={{
                appTheme,
                toggleAppTheme: (themeType) => setThemeMode(themeType as ThemeMode),
                themeMode,
            }}
        >
            <ConfigProvider theme={themeConfig}>{children}</ConfigProvider>
        </ThemeContext.Provider>
    )
}

export default ThemeContextProvider
