import {ReactNode, useMemo} from "react"

import {theme as antdTheme} from "antd"
import {ThemeProvider} from "react-jss"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

// Bridge the Ant Design theme tokens into the react-jss ThemeProvider so components rendered
// outside of Layout (e.g. global drawers) still receive the same token values
const ThemeContextBridge = ({children}: {children: ReactNode}) => {
    const {appTheme} = useAppTheme()
    const {token} = antdTheme.useToken()
    const isDark = appTheme === "dark"

    // antd's useToken returns a per-theme-cached token object, so this only changes on theme swaps
    const jssTheme = useMemo(() => ({...token, isDark}), [token, isDark])

    return <ThemeProvider theme={jssTheme}>{children}</ThemeProvider>
}

export default ThemeContextBridge
