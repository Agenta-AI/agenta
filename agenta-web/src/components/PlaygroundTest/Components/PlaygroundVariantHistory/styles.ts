import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    navigationContainer: {
        height: "100%",
        width: 200,
        display: "flex",
        flexDirection: "column",
        gap: 4,
    },
    navigation: {
        padding: "8px 12px",
        borderRadius: theme.borderRadiusSM,
        width: "100%",
        cursor: "pointer",
        transitionDuration: 0.3,
        "&:hover": {
            backgroundColor: theme.colorBorderSecondary,
        },
    },
    selectedNavigation: {
          backgroundColor: theme.colorBorderSecondary,
    },
    historyContainer: {
        width: "100%",
        display: "flex",
        flexDirection: "column",
        border: `2px solid ${theme.colorBorderSecondary}`,
        borderRadius: theme.borderRadiusLG,
    },
    historyContainerHeader: {
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
    },
}))
