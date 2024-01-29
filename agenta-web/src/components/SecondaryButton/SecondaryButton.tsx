import React from "react"
import {Button} from "antd"
import {createUseStyles} from "react-jss"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {ExportOutlined} from "@ant-design/icons"

type SecondaryBtnProps = {
    children: React.ReactNode
    disabled: boolean
    onClick: () => void
}

type StyleProps = {
    themeMode: "dark" | "light"
}

const SecondaryButton: React.FC<SecondaryBtnProps> = ({children, ...props}) => {
    const {appTheme} = useAppTheme()

    return (
        <Button {...props} icon={<ExportOutlined />} size="large">
            {children}
        </Button>
    )
}

export default SecondaryButton
