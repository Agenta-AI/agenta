import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    editor: {
        border: `1px solid ${theme.colorBorder}`,
        borderRadius: theme.borderRadius,
        overflow: "hidden",
        "& .monaco-editor": {
            width: "0 !important",
        },
    },
    drawerHeading: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    container: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
    },
    label: {
        fontWeight: theme.fontWeightMedium,
    },
}))
