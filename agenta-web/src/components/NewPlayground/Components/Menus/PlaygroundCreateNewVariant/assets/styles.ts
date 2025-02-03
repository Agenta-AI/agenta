import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    variant: {
        borderRadius: theme.borderRadiusLG,
        padding: 8,
        position: "relative",
        cursor: "pointer",
        "&:hover": {
            backgroundColor: theme.controlItemBgActive,
        },
    },
    selectedVariant: {
        backgroundColor: theme.controlItemBgActive,
    },
}))
