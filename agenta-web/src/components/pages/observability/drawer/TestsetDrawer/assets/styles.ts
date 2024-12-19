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
    customTag: {
        marginLeft: 8,
        fontSize: "10px",
        backgroundColor: theme.blue1,
        color: theme.blue4,
        padding: `2px 4px`,
        borderRadius: "2px",
    },
}))
