import {ConfigProvider, theme} from "antd"
import {PropsWithChildren, createContext, useState, useContext, useEffect} from "react"
import {useLocalStorage, useUpdateEffect} from "usehooks-ts"

export const AntdThemeConfig = {
    token: {
        // Seed Token
        colorPrimary: "#4AA081",
        borderRadius: 8,
    },
    components: {
        Button: {
            colorPrimary: "#4AA081",
            colorErrorText: "#ef4146",
        },
    },
}

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

const getDeviceTheme = () => {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? ThemeMode.Dark
        : ThemeMode.Light
}

const getAppTheme = (themeMode: ThemeMode) =>
    themeMode === ThemeMode.System ? getDeviceTheme() : themeMode

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

    useUpdateEffect(() => {
        setAppTheme(getAppTheme(themeMode))
    }, [themeMode])

    const val = appTheme || ThemeMode.Light

    return (
        <ThemeContext.Provider
            value={{
                appTheme: val,
                toggleAppTheme: (themeType) => setThemeMode(themeType as ThemeMode),
                themeMode,
            }}
        >
            <ConfigProvider
                theme={{
                    algorithm:
                        val === ThemeMode.Dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
                    ...AntdThemeConfig,
                }}
            >
                {children}
            </ConfigProvider>
        </ThemeContext.Provider>
    )
}

export default ThemeContextProvider
