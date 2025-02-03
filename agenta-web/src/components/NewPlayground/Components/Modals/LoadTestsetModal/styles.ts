import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        "& .ant-modal-body": {
            height: 600,
            overflowY: "auto",
        },
    },
    subTitle: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    sidebar: {
        display: "flex",
        flexDirection: "column",
        gap: theme.padding,
        width: 200,
    },
    menu: {
        height: 500,
        overflowY: "auto",
        borderInlineEnd: `0px !important`,
    },
}))
