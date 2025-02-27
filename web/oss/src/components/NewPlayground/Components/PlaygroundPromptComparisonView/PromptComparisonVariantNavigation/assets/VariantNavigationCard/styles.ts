import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    card: {
        border: `1px solid ${theme.colorBorderSecondary}`,
        backgroundColor: theme.colorBgElevated,
    },
}))
