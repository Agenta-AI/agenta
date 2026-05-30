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

// Brand seed for dark mode: the light brand primary (#1c2c3d navy) is invisible on
// dark surfaces, so the primary accent becomes the Agenta brand yellow (logo color).
const DARK_PRIMARY = "#f2f25c"
const darkSeed = {
    colorPrimary: DARK_PRIMARY,
    colorSuccess: "#52c41a",
    colorWarning: "#faad14",
    colorError: "#ff4d4f",
}
// On a bright yellow primary, antd's default light-solid (#fff) label is unreadable —
// force dark text on primary-colored buttons in dark mode.
const darkComponents = {
    Button: {
        primaryColor: "#141414",
    },
}

const ThemeContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [themeMode, setThemeMode] = useLocalStorage<ThemeMode>("agenta-theme", ThemeMode.Light)
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
    // Tailwind `dark:` variants) reflect the active theme.
    useEffect(() => {
        const root = document.documentElement
        root.classList.toggle("dark", appTheme === ThemeMode.Dark)
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
                token: {
                    ...baseToken,
                    ...stripColors(antdTokens.token),
                    ...darkSeed,
                },
                components: darkComponents,
            }
        }

        // Light mode preserved exactly as before: token + (inert) component config
        // are both spread into `token`, matching the prior ConfigProvider shape.
        return {
            algorithm: theme.defaultAlgorithm,
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
