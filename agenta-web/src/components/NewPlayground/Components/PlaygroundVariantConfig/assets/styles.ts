import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
        padding: `8px ${theme.padding}px`,
        backgroundColor: theme.colorBgBase,
    },
}))
