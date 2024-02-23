import React from "react"
import {StyleProvider} from "@ant-design/cssinjs"

interface Props {
    children: React.ReactNode
}

// To enforce antd styles when tailwindcss styles are conflicting
// more details at: https://ant.design/docs/react/compatible-style#compatible-adjustment
const EnforceAntdStyles: React.FC<Props> = ({children}) => {
    return <StyleProvider hashPriority="high">{children}</StyleProvider>
}

export default EnforceAntdStyles
