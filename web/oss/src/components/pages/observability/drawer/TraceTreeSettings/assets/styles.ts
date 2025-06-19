import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    content: {
        borderTop: `0.5px solid ${theme.colorSplit}`,
        borderBottom: `0.5px solid ${theme.colorSplit}`,
        padding: `${theme.paddingXS}px ${theme.padding}px`,
    },
    container: {
        padding: `${theme.paddingSM}px ${theme.paddingSM}px ${theme.paddingSM}px ${theme.padding}px`,
    },
    title: {
        fontSize: theme.fontSizeHeading5,
        lineHeight: theme.lineHeightHeading5,
        fontWeight: theme.fontWeightMedium,
    },
}))
