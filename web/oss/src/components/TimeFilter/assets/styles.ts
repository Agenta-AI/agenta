import {createUseStyles} from "react-jss"

import type {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    timeFilter: {
        minWidth: 120,
        "& .ant-select-selector": {
            borderColor: theme.colorBorder,
        },
    },
}))
