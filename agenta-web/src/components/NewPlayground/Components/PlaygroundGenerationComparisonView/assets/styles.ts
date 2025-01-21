import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        width: "100%",
        height: 44,
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
        borderRight: `1px solid ${theme.colorBorderSecondary}`,
        padding: `0px 16px`,
        display: "flex",
        gap: 8,
        alignItems: "center",
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
        backgroundColor: theme.colorBgBase,
    },
}))
