import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    treeLine: {
        "&::before": {
            content: "''",
            position: "absolute",
            left: 6,
            top: 0,
            bottom: -12,
            width: 1,
            backgroundColor: theme.colorBorder,
        },
        "&.last::before": {
            height: "50%",
            bottom: "auto",
        },
    },
    nodeLabel: {
        position: "relative",
        cursor: "default",
        display: "flex",
        alignItems: "center",
        marginTop: 12,
        marginBottom: 12,
        "&::before": {
            content: "''",
            position: "absolute",
            top: "50%",
            left: -13,
            width: 12,
            height: 1,
            backgroundColor: theme.colorBorder,
        },
    },

    nodeLabelContent: {
        maxWidth: 200,
        padding: "2px 4px",
        borderRadius: theme.borderRadius,
        cursor: "pointer",
        "&:hover": {
            backgroundColor: "rgba(5, 23, 41, 0.06)",
        },
    },
}))
