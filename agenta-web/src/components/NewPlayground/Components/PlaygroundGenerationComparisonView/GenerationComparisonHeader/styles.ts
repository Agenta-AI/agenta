import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    header: {
        backgroundColor: theme.controlItemBgActive,
    },
    heading: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
    },
}))
