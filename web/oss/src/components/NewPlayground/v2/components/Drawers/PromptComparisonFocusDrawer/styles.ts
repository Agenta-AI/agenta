import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    tabHeader: {
        "& > .ant-tabs-nav": {
            backgroundColor: theme.controlItemBgActive,
            padding: "0px 8px",
        },
    },
}))
