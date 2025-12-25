import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

// Tree line styles using CSS pseudo-elements
export const useTreeStyles = createUseStyles((theme: JSSTheme) => ({
    treeNode: {
        position: "relative",
        paddingLeft: 12,
        paddingTop: 8,
        "&::before": {
            content: "''",
            position: "absolute",
            left: 4,
            top: 0,
            bottom: 0,
            width: 1,
            backgroundColor: theme.colorBorder || "#e5e7eb",
        },
        "&.last::before": {
            height: 16,
            bottom: "auto",
        },
    },
    treeNodeLabel: {
        position: "relative",
        paddingBottom: 4,
        "&::before": {
            content: "''",
            position: "absolute",
            top: 8,
            left: -12,
            width: 10,
            height: 1,
            backgroundColor: theme.colorBorder || "#e5e7eb",
        },
    },
    treeNodeContent: {
        marginTop: 4,
    },
}))
