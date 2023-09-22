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

const useStyles = createUseStyles({
    exportBtn: ({themeMode}: StyleProps) => ({
        backgroundColor: themeMode === "dark" ? "#fff" : "#000",
        color: themeMode === "dark" ? "#000" : "#fff",
        border: "none",
        "&:not([disabled]):hover": {
            backgroundColor: themeMode === "dark" ? "rgba(255, 255, 255,0.8)" : "rgba(0, 0, 0,0.8)",
            color: `${themeMode === "dark" ? "#000" : "#fff"} !important`,
        },
    }),
})

const SecondaryButton: React.FC<SecondaryBtnProps> = ({children, ...props}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles({themeMode: appTheme} as StyleProps)

    return (
        <Button
            {...props}
            icon={<ExportOutlined />}
            size="large"
            className={`${classes.exportBtn}`}
        >
            {children}
        </Button>
    )
}

export default SecondaryButton
