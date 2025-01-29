import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "flex",
        flexDirection: "column",
        rowGap: 20,
    },
    envButtons: {
        "& .ant-radio-button-wrapper-checked": {
            backgroundColor: theme.colorPrimary,
            color: theme.colorWhite,
            "&:hover": {
                color: theme.colorWhite,
            },
        },
    },
}))
