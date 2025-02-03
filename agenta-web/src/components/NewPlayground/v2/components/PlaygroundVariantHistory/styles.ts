import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    headerContainer: {
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
    },
    menuContainer: {
        borderRight: `1px solid ${theme.colorBorderSecondary}`,
    },
    menu: {
        overflowY: "auto",
        borderInlineEnd: `0px !important`,
    },
}))
