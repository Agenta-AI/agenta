import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

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
        "& .ant-modal-footer": {
            marginTop: 24,
        },
    },
    modal: {
        display: "flex",
        flexDirection: "column",
        gap: 24,
    },
    headerText: {
        "& .ant-typography": {
            lineHeight: theme.lineHeightLG,
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightStrong,
        },
    },
    label: {
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeight,
    },
}))
