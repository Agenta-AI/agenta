import {JSSTheme} from "@/lib/Types"
import {createUseStyles} from "react-jss"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    sidebar: {
        background: `${theme.colorBgContainer} !important`,
        height: "100vh",
        position: "sticky !important",
        bottom: "0px",
        top: "0px",
        "&>div:nth-of-type(2)": {
            background: `${theme.colorBgContainer} !important`,
        },
    },
    siderWrapper: {
        border: `0.01px solid ${theme.isDark ? "#222" : "#ddd"}`,
        zIndex: 1000,
    },
    sliderContainer: {
        display: "flex",
        flexDirection: "column",
        borderRight: "0.01px solid rgba(5, 23, 41, 0.06)",
        height: "100%",
        padding: "10px",
        "& > div:nth-of-type(1)": {
            display: "flex",
            justifyContent: "center",
        },
        "& > div:nth-of-type(3)": {
            display: "flex",
            justifyContent: "space-between",
            flexDirection: "column",
            flex: 1,
            overflowY: "auto",
        },
        "& .ant-menu-item,.ant-menu-submenu-title": {
            padding: "0 16px !important",
        },
    },
    menuContainer: {
        borderRight: "0 !important",
        overflowY: "auto",
        position: "relative",
        "& .ant-menu-item-selected": {
            fontWeight: theme.fontWeightMedium,
        },
    },
    menuContainer2: {
        borderRight: "0 !important",
    },
    menuLinks: {
        display: "inline-block",
        width: "100%",
    },
    avatarMainContainer: {
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "4px 16px 4px 8px",
        borderRadius: theme.borderRadiusLG,
    },
    avatarContainer: {
        display: "flex",
        alignItems: "center",
        gap: theme.paddingSM,
        "& > div": {
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            "& .ant-typography:nth-of-type(2)": {
                color: theme.colorTextDescription,
            },
        },
    },
    menuHeader: {
        color: theme.colorTextDescription,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
}))
