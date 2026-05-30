import {createUseStyles} from "react-jss"

import type {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    resultTag: {
        display: "flex",
        alignItems: "center",
        width: "fit-content",
        padding: 0,
        cursor: "pointer",
        "& > span.value1": {
            backgroundColor: theme.colorFillQuaternary,
            flex: 1,
            padding: "0px 8px",
            borderRight: `1px solid ${theme.colorBorder}`,
        },
        "& > span.value2": {
            background: theme.colorBgContainer,
            padding: "0px 8px 0px 4px",
            borderRadius: "inherit",
        },
        "& > div.singleValue": {
            padding: "0px 8px",
            display: "flex",
            alignItems: "center",
            gap: 8,
        },
    },
}))
