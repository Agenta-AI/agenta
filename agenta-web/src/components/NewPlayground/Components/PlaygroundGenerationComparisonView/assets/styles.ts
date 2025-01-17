import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        width: "100%",
        height: 40,
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
        padding: `0px 16px`,
        display: "flex",
        gap: 4,
        alignItems: "center",
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
    },
}))
