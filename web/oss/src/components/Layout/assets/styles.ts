import {createUseStyles} from "react-jss"

import type {JSSTheme, StyleProps as MainStyleProps} from "@/oss/lib/Types"

export type StyleProps = MainStyleProps

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    layout: {
        display: "flex",
        background: theme.colorBgContainer,
        height: "100%",
        minHeight: "100vh",
        position: "relative",
    },
    content: {
        height: "100%",
        paddingTop: "24px",
        paddingLeft: "1.5rem",
        paddingRight: "1.5rem",
        marginBottom: "2rem",
        flex: 1,
        gap: 16,
    },
    breadcrumbContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "8px 1.5rem",
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
    },
    topRightBar: {
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        "& span.ant-typography": {
            color: theme.colorTextTertiary,
        },
    },
    banner: {
        position: "sticky",
        zIndex: 10,
        top: 0,
        left: 0,
        height: 38,
        // Fixed white text sits on this; colorBgSpotlight stays dark in both themes.
        backgroundColor: theme.colorBgSpotlight,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        color: "#fff",
        fontSize: 12,
        lineHeight: "20px",
        fontWeight: 500,
        "& span": {
            fontWeight: 600,
        },
    },
    notFoundContainer: {
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        "& .ant-typography:nth-of-type(1)": {
            fontSize: 24,
            fontWeight: 600,
        },
        "& .ant-typography:nth-of-type(2)": {
            fontSize: 14,
            marginTop: 8,
        },
    },
}))
