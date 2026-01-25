import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontWeight: 600,
    },
    welcomeCardContainer: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        flex: 1,
        border: "1px solid #EAEFF5",
        borderRadius: "10px",
        backgroundColor: "white",
        boxShadow:
            "0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px 0 rgba(0, 0, 0, 0.02)",
        cursor: "pointer",
    },
}))
