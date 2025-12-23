import {IBM_Plex_Mono} from "next/font/google"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

const ibm_plex_mono = IBM_Plex_Mono({weight: "400", subsets: ["latin"]})

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    modalContainer: {
        transition: "width 0.3s ease",
        "& > div": {
            height: "100%",
        },
        "& .ant-modal-container": {
            padding: 0,
        },
        "& h1.ant-typography": {
            fontSize: theme.fontSizeHeading3,
            lineHeight: theme.lineHeightHeading3,
            fontWeight: theme.fontWeightMedium,
        },
        "& span.ant-typography": {
            fontSize: theme.fontSizeLG,
            lineHeight: theme.lineHeightLG,
        },
        "& .ant-modal-content": {
            height: "100%",
            overflowY: "hidden",
            borderRadius: 16,
            padding: 0,
            "& .ant-modal-body": {
                height: "100%",
            },
        },
    },
    modalHeader: {
        padding: `${theme.padding}px ${theme.paddingLG}px`,
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
        "& .ant-typography": {
            flex: 1,
            fontSize: theme.fontSizeHeading5,
            lineHeight: theme.lineHeightHeading5,
            fontWeight: theme.fontWeightMedium,
        },
    },
    modalBody: {
        padding: `${theme.paddingSM}px ${theme.paddingLG}px`,
        display: "flex",
        height: "100%",
        flexDirection: "column",
        overflowY: "auto",
        gap: 12,
        "& .ant-tabs-tab-btn": {
            display: "flex",
            alignItems: "center",
            gap: "0px",
            "& .ant-tabs-tab-icon": {
                display: "flex",
                marginRight: 0,
            },
        },
        "& .ant-tabs-tab": {
            padding: "0px 0px",
            marginRight: "0px",
        },
    },
    command: {
        padding: theme.paddingXS,
        backgroundColor: theme.colorBgContainerDisabled,
        borderRadius: theme.borderRadius,
        overflow: "auto",
        "& pre": {
            fontFamily: ibm_plex_mono.style.fontFamily,
        },
    },
    tabs: {
        height: "100%",
        overflowY: "auto",
        "& .ant-tabs-nav": {
            marginBottom: 24,
        },
        "& .ant-tabs-content-holder": {
            height: "100%",
            overflowY: "auto",
        },
    },
}))
