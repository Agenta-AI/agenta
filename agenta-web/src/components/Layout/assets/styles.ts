import {createUseStyles} from "react-jss"

import type {JSSTheme, StyleProps as MainStyleProps} from "@/lib/Types"

export interface StyleProps extends MainStyleProps {
    footerHeight: number
}

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    layout: ({themeMode}: StyleProps) => ({
        display: "flex",
        background: themeMode === "dark" ? "#141414" : "#ffffff",
        height: "100%",
        minHeight: "100vh",
        position: "relative",
    }),
    content: ({footerHeight}: StyleProps) => ({
        height: `calc(100% - ${footerHeight ?? 0}px)`,
        paddingLeft: "1.5rem",
        paddingRight: "1.5rem",
        marginBottom: `calc(2rem + ${footerHeight ?? 0}px)`,
        flex: 1,
    }),
    breadcrumbContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "8px 1.5rem",
        marginBottom: 24,
        borderBottom: "1px solid #eaeff5",
    },
    footer: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        textAlign: "center",
        padding: "5px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    footerLeft: {
        fontSize: 18,
    },
    footerLinkIcon: ({themeMode}: StyleProps) => ({
        color: themeMode === "dark" ? "#fff" : "#000",
    }),
    topRightBar: {
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        "& span.ant-typography": {
            color: "rgba(0, 0, 0, 0.45)",
        },
    },
    banner: {
        position: "sticky",
        zIndex: 10,
        top: 0,
        left: 0,
        height: 38,
        backgroundColor: "#1c2c3d",
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
