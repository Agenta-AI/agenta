import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    tabHeader: {
        "& > .ant-tabs-nav": {
            backgroundColor: theme.controlItemBgActive,
            padding: "0px 8px",
        },
    },
}))
