import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => {
    return {
        collapseContainer: {
            "& .ant-collapse-header": {
                backgroundColor: `#FAFAFB !important`,
                borderBottom: `1px solid ${theme.colorSplit} !important`,
            },
            "& .ant-collapse-item": {
                display: "flex !important",
                flexDirection: "column",
            },
            "& .ant-collapse-content": {
                borderBottom: `0.1px solid ${theme.colorBorder} !important`,
                borderRadius: "0px !important",
            },
        },
    }
})
