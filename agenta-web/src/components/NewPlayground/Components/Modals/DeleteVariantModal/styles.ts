import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    heading: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
}))
