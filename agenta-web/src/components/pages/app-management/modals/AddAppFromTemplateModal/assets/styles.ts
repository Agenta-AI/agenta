import {createUseStyles} from "react-jss"

import type {JSSTheme} from "@/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    modalContainer: {
        transition: "width 0.3s ease",
        "& .ant-modal-content": {
            overflow: "hidden",
            borderRadius: 16,
            "& > .ant-modal-close": {
                top: 16,
            },
        },
    },
    modal: {
        display: "flex",
        flexDirection: "column",
        gap: 24,
    },
    modalError: {
        color: theme.colorError,
        marginTop: 2,
    },
    headerText: {
        "& .ant-typography": {
            lineHeight: theme.lineHeightLG,
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightStrong,
        },
    },
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightLG,
    },
    label: {
        fontWeight: theme.fontWeightMedium,
    },
    card: {
        width: 208,
        height: 180,
        cursor: "pointer",
        transitionDuration: "0.3s",
        "&:hover": {
            boxShadow: theme.boxShadow,
        },
        "& > .ant-card-head": {
            minHeight: 0,
            padding: theme.paddingSM,

            "& .ant-card-head-title": {
                fontSize: theme.fontSize,
                fontWeight: theme.fontWeightMedium,
                lineHeight: theme.lineHeight,
            },
        },
        "& > .ant-card-body": {
            padding: theme.paddingSM,
            "& > .ant-typography": {
                color: theme.colorTextSecondary,
            },
        },
    },
    inputName: {
        borderColor: `${theme.colorError} !important`,
        "&  .ant-input-clear-icon": {
            color: theme.colorError,
        },
    },
}))
