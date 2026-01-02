import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    annotationPopover: {
        width: 300,
        "& .ant-popover-container": {
            padding: `0px !important`,
        },
        "& .ant-popover-title": {
            padding: 8,
            borderBottom: `1px solid ${theme.colorSplit}`,
        },
        "& .ant-popover-content": {
            padding: 8,
            maxHeight: 200,
            overflowY: "auto",
        },
    },
}))
