import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    card: {
        border: `1px solid ${theme.colorBorderSecondary}`,
        backgroundColor: theme.colorBgElevated,
    },
}))
