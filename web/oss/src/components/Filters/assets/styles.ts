import {JSSTheme} from "@/oss/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    popover: {
        "&.ant-popover": {
            maxWidth: "100vw",
        },
        "& .ant-popover-inner": {
            width: "clamp(320px, 60vw, 700px)",
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "min(70vh, 640px)",
            padding: 0,
        },
    },
    fieldDropdownSubmenu: {
        "& .ant-dropdown-menu": {
            width: "100%",
            maxWidth: "min(560px, calc(100vw - 32px))",
            maxHeight: "60vh",
            overflow: "auto",
        },
    },
    filterHeading: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `${theme.paddingXS}px ${theme.paddingXS}px ${theme.paddingXS}px ${theme.padding}px`,
        gap: theme.marginSM,
        "& .ant-typography": {
            fontSize: theme.fontSizeHeading5,
            lineHeight: theme.lineHeightHeading5,
            fontWeight: theme.fontWeightMedium,
        },
    },
    filterContainer: {
        display: "flex",
        gap: theme.marginXS,
        flexDirection: "column",
        padding: theme.paddingXS,
    },
}))
