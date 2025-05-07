import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    header: {
        backgroundColor: theme.controlItemBgActive,
    },
    heading: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
    },
}))
