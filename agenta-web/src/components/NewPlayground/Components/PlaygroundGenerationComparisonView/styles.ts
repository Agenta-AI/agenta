import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
        backgroundColor: theme.controlItemBgActive,
    },
    containerBorder: {
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
        borderRight: `1px solid ${theme.colorBorderSecondary}`,
    },
}))
