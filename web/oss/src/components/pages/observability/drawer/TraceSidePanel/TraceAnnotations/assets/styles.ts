import {JSSTheme} from "@/oss/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    annotationPopover: {
        width: 300,
        "& .ant-popover-inner": {
            padding: `0px !important`,
        },
        "& .ant-popover-title": {
            padding: 8,
            borderBottom: `1px solid ${theme.colorSplit}`,
        },
        "& .ant-popover-inner-content": {
            padding: 8,
            maxHeight: 200,
            overflowY: "auto",
        },
    },
}))
