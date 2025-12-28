import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    modalContainer: {
        // height: 800,
        overflowY: "hidden",
        "& > div": {
            height: "100%",
        },
        "& .ant-modal-content": {
            height: "100%",
            display: "flex",
            flexDirection: "column",
            "& .ant-modal-body": {
                overflowY: "auto",
                flex: 1,
                paddingTop: theme.padding,
                paddingBottom: theme.padding,
            },
        },
    },
    collapseContainer: {
        "& .ant-collapse-header": {
            alignItems: "center !important",
        },
        "& .ant-collapse-content": {
            maxHeight: 400,
            height: "100%",
            overflowY: "auto",
            "& .ant-collapse-content-box": {
                padding: 0,
            },
        },
    },
    title: {
        fontSize: theme.fontSizeHeading5,
        lineHeight: theme.lineHeightHeading5,
        fontWeight: theme.fontWeightMedium,
    },
    subTitle: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
        fontWeight: theme.fontWeightMedium,
    },
    container: {
        width: 400,
        "& .ant-popover-title": {
            marginBottom: theme.margin,
        },
        "& .ant-popover-inner": {
            padding: `${theme.paddingSM}px ${theme.padding}px`,
        },
    },
    tabsContainer: {
        height: "100%",
        display: "flex",
        "& .ant-tabs-content-holder": {
            paddingLeft: theme.padding,
            flex: 1,
            overflow: "auto",
        },
        "& .ant-tabs-tab": {
            color: theme.colorTextSecondary,
            "&:hover": {
                backgroundColor: theme.colorInfoBg,
            },
        },
        "& .ant-tabs-ink-bar": {
            display: "none",
        },
        "& .ant-tabs-tab-active": {
            backgroundColor: theme.controlItemBgActive,
            borderRight: `2px solid ${theme.colorPrimary}`,
            color: theme.colorPrimary,
            fontWeight: `${theme.fontWeightMedium} !important`,
        },
    },
}))
