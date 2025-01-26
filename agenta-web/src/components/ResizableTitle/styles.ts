import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    filterRoot: {
        padding: "1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
    },
    resizableHandle: {
        position: "absolute",
        width: 10,
        height: "100%",
        right: "-5px",
        bottom: 0,
        cursor: "col-resize",
        zIndex: 1,
    },
    dropdownMenu: {
        "&>.ant-dropdown-menu-item": {
            "& .anticon-check": {
                display: "none",
            },
        },
        "&>.ant-dropdown-menu-item-selected": {
            "&:not(:hover)": {
                backgroundColor: "transparent !important",
            },
            "& .anticon-check": {
                display: "inline-flex !important",
            },
        },
    },
}))
