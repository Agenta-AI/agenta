import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"
export const useEvaluatorTestcaseModalStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        "& .ant-modal-body": {
            height: 600,
            overflowY: "auto",
        },
    },
    title: {
        fontSize: theme.fontSizeHeading4,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightStrong,
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
