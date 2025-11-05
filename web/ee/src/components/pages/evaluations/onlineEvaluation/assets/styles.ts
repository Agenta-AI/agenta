import {createUseStyles} from "react-jss"

import type {JSSTheme} from "@/oss/lib/Types"

export const useDrawerStyles = createUseStyles((theme: JSSTheme) => ({
    collapseContainer: {
        "& .ant-collapse-header": {
            borderBottom: `1px solid ${theme.colorSplit} !important`,
        },
        "& .ant-collapse-item": {
            display: "flex !important",
            flexDirection: "column",
        },
        "& .ant-collapse-content": {
            borderBottom: `0.1px solid ${theme.colorSplit} !important`,
            borderRadius: "0px !important",
        },
    },
    collapse: {
        "& .ant-collapse-item": {
            border: "none !important",
            borderRadius: "10px !important",
            overflow: "hidden",
            backgroundColor: "#FFFFFF",
            boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
        },
        "& .ant-collapse-item + .ant-collapse-item": {
            marginTop: "8px",
        },
        "& .ant-collapse-header": {
            backgroundColor: `#FAFAFB !important`,
            borderBottom: `1px solid ${theme.colorSplit} !important`,
            padding: "12px 16px !important",
        },
        "& .ant-collapse-content": {
            borderTop: "none !important",
            borderRadius: "0 0 10px 10px !important",
        },
        "& .ant-collapse-content > .ant-collapse-content-box": {
            padding: "16px !important",
        },
    },
}))
