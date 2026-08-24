import {useThemeMode, type ThemeModeValue} from "@agenta/ui/theme"
import {ConfigProvider, theme} from "antd"
import {createContext, type PropsWithChildren, useContext} from "react"

interface ThemeContextValue {
    mode: ThemeModeValue
    resolved: "light" | "dark"
    setMode: (mode: ThemeModeValue) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export const ThemeProvider = ({children}: PropsWithChildren) => {
    const {themeMode, resolved, setMode} = useThemeMode()
    return (
        <ThemeContext.Provider value={{mode: themeMode, resolved, setMode}}>
            <ConfigProvider
                theme={{
                    algorithm: resolved === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
                    token: {
                        colorPrimary: "var(--ag-colorPrimary)",
                        colorBgBase: "var(--ag-colorBgBase)",
                        colorTextBase: "var(--ag-colorText)",
                        colorBorder: "var(--ag-colorBorder)",
                        borderRadius: 8,
                        fontFamily: "var(--font-sans)",
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
