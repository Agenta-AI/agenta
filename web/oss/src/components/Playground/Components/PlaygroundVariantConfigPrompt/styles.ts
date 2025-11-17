import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => {
    return {
        collapseContainer: {
            backgroundColor: "transparent",
            "& .ant-collapse-header": {
                backgroundColor: "transparent !important",
                borderBottom: `1px solid ${theme.colorSplit} !important`,
            },
            "& .ant-collapse-item": {
                display: "flex !important",
                flexDirection: "column",
            },
            "& .ant-collapse-content": {
                backgroundColor: "transparent !important",
                borderBottom: `0.1px solid ${theme.colorSplit} !important`,
                borderRadius: "0px !important",
            },
        },
    }
})
