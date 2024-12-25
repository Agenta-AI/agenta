import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    dropdonwContainer: {
        backgroundColor: theme.colorBgElevated,
        borderRadius: theme.borderRadiusLG,
        boxShadow: theme.boxShadowSecondary,
        padding: 8,
    },
}))
