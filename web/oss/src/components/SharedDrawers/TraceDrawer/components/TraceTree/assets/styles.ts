import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    treeHeader: {
        "& .ant-typography": {
            fontSize: theme.fontSizeHeading5,
            lineHeight: theme.lineHeightHeading5,
            fontWeight: theme.fontWeightMedium,
        },
    },
    treeTitle: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
    },
    treeContentContainer: {
        color: theme.colorTextSecondary,
    },
    treeContent: {
        display: "flex",
        alignItems: "center",
        fontFamily: "monospace",
        gap: 2,
    },
    popover: {
        "& .ant-popover-container": {
            width: 200,
            padding: 0,
        },
    },
}))
