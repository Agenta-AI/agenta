import {PropsWithChildren, createContext, useState, useContext, useEffect} from "react"

export const ThemeContext = createContext<{
    appTheme: string
    toggleAppTheme: () => void
}>({
    appTheme: "light",
    toggleAppTheme: () => {},
})

export const useAppTheme = () => useContext(ThemeContext)

const ThemeContextProvider: React.FC<PropsWithChildren> = ({children}) => {
    const [appTheme, setAppTheme] = useState<string | null>(null)

    const getDeviceTheme = (): string => {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }

    useEffect(() => {
        const savedTheme = localStorage.getItem("agenta-theme")
        setAppTheme(savedTheme || getDeviceTheme())
    }, [])

    useEffect(() => {
        if (appTheme) localStorage.setItem("agenta-theme", appTheme)
    }, [appTheme])

    const toggleAppTheme = () => {
        setAppTheme((prevTheme) => (prevTheme === "dark" ? "light" : "dark"))
    }

    return (
        <ThemeContext.Provider value={{appTheme: appTheme || "light", toggleAppTheme}}>
            {children}
        </ThemeContext.Provider>
    )
}

export default ThemeContextProvider
