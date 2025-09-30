import {ReactNode} from "react"

import {theme as antdTheme} from "antd"
import {ThemeProvider} from "react-jss"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"

// Bridge the Ant Design theme tokens into the react-jss ThemeProvider so components rendered
// outside of Layout (e.g. global drawers) still receive the same token values.
const ThemeContextBridge = ({children}: {children: ReactNode}) => {
    const {appTheme} = useAppTheme()
    const {token} = antdTheme.useToken()

    return <ThemeProvider theme={{...token, isDark: appTheme === "dark"}}>{children}</ThemeProvider>
}

export default ThemeContextBridge
