import {useThemeMode, type ThemeModeValue} from "@agenta/ui/theme"
import {ConfigProvider, theme} from "antd"
import {createContext, type PropsWithChildren, useContext} from "react"

interface ThemeContextValue {
    mode: ThemeModeValue
    resolved: "light" | "dark"
    setMode: (mode: ThemeModeValue) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// antd tokens must be real colors: it derives surfaces via JS color math, so
// var() strings parse as invalid and collapse to black. Values mirror the
// generated palette (theme-variables.css / antd-overrides.generated.ts).
const LIGHT_TOKENS = {
    colorPrimary: "#242424",
    colorBgBase: "#ffffff",
    colorTextBase: "#242424",
    colorBorder: "#d7d7d7",
}
const DARK_TOKENS = {
    colorPrimary: "#f2f25c",
    colorLink: "#8ccfff",
}

export const ThemeProvider = ({children}: PropsWithChildren) => {
    const {themeMode, resolved, setMode} = useThemeMode()
    return (
        <ThemeContext.Provider value={{mode: themeMode, resolved, setMode}}>
            <ConfigProvider
                theme={{
                    algorithm: resolved === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
                    token: {
                        borderRadius: 8,
                        fontFamily: "var(--font-sans)",
                        ...(resolved === "dark" ? DARK_TOKENS : LIGHT_TOKENS),
                    },
                }}
            >
                {children}
            </ConfigProvider>
        </ThemeContext.Provider>
    )
}

export function useLocalTheme() {
    const context = useContext(ThemeContext)
    if (!context) throw new Error("useLocalTheme must be used inside ThemeProvider")
    return context
}
