import {createUseStyles} from "react-jss"

import type {JSSTheme} from "@/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    drawerTitleContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& h1.ant-typography": {
            fontSize: theme.fontSizeHeading5,
            fontWeight: theme.fontWeightMedium,
            textTransform: "capitalize",
        },
    },
    noDataContainer: {
        height: 200,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
    },
}))
