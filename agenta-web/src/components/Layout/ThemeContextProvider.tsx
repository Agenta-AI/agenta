import {PropsWithChildren, createContext, useState, useContext, useEffect} from "react"

export const ThemeContext = createContext<{
    appTheme: string
    toggleAppTheme: (themeName: string) => void
}>({
    appTheme: "light",
    toggleAppTheme: () => {},
})

export const useAppTheme = () => useContext(ThemeContext)

const ThemeContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [appTheme, setAppTheme] = useState<string | null>(null)
    const [sysTheme, setSysTheme] = useState(false)

    const getDeviceTheme = (): string => {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }

    useEffect(() => {
        const savedTheme = localStorage.getItem("agenta-theme")
        if (savedTheme) {
            setAppTheme(savedTheme)
        } else {
            setAppTheme(getDeviceTheme())
            setSysTheme(true)
        }
    }, [])

    useEffect(() => {
        if (appTheme) localStorage.setItem("agenta-theme", appTheme)
    }, [appTheme])

    useEffect(() => {
        const handleSystemThemeChange = ({matches}: MediaQueryListEvent) => {
            if (sysTheme) {
                setAppTheme(matches ? "dark" : "light")
            }
        }

        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
        mediaQuery.addEventListener("change", handleSystemThemeChange)

        return () => {
            mediaQuery.removeEventListener("change", handleSystemThemeChange)
        }
    }, [sysTheme])

    const toggleAppTheme = (themeName: string) => {
        if (themeName === "system") {
            setAppTheme(getDeviceTheme())
            setSysTheme(true)
        } else {
            setAppTheme(themeName)
            setSysTheme(false)
        }
    }

    return (
        <ThemeContext.Provider
            value={{
                appTheme: appTheme || "light",
                toggleAppTheme,
            }}
        >
            {children}
        </ThemeContext.Provider>
    )
}

export default ThemeContextProvider
