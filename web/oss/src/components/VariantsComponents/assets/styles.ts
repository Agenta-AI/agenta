import {JSSTheme} from "@/oss/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        gap: theme.marginLG,
    },
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading4,
    },
}))
