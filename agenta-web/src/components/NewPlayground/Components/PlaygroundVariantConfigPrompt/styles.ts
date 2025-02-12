import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    collapseContainer: {
        "& .ant-collapse-content": {
            borderBottom: `0.1px solid ${theme.colorBorder} !important`,
            borderRadius: "0px !important",
        },
    },
}))
