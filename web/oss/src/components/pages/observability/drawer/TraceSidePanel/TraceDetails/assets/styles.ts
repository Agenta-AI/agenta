import {JSSTheme} from "@/oss/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
        fontWeight: theme.fontWeightMedium,
    },
    resultTag: {
        display: "flex",
        alignItems: "center",
        fontFamily: "monospace",
        gap: 4,
    },
    tokenContainer: {
        "& > div:nth-of-type(1)": {
            lineHeight: theme.lineHeight,
            fontWeight: theme.fontWeightMedium,
        },
        "& > div:nth-of-type(2)": {
            lineHeight: theme.lineHeight,
            fontWeight: 400,
        },
    },
}))
