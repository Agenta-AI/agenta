import {createUseStyles} from "react-jss"
import type {JSSTheme} from "@/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    resultTag: {
        display: "flex",
        alignItems: "center",
        width: "fit-content",
        padding: 0,
        cursor: "pointer",
        "& > span.value1": {
            backgroundColor: "rgba(0, 0, 0, 0.02)",
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
