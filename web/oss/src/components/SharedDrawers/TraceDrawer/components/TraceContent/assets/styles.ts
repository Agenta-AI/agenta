import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        "& .ant-tag": {
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
        },
    },
    title: {
        fontSize: theme.fontSizeHeading5,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightHeading5,
    },
    subTitle: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
        fontWeight: theme.fontWeightMedium,
    },
    tabs: {
        "& .ant-tabs-nav": {
            marginBottom: 8,
            flexWrap: "wrap-reverse",
            "& .ant-tabs-nav-wrap": {
                padding: "0 16px",
            },
        },
        "& .ant-tabs-content-holder": {
            padding: theme.padding,
            flex: 1,
            "& .ant-tabs-content": {
                height: "100%",
                "& .ant-tabs-tabpane": {
                    height: "100%",
                },
            },
        },
        "& .ant-tabs-nav-operations": {
            display: "none !important",
        },
        "& .ant-tabs-extra-content": {
            paddingTop: 10,
            paddingBottom: 10,
            paddingLeft: 16,
        },
    },
}))
