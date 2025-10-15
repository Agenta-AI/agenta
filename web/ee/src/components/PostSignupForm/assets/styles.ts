import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    mainContainer: {
        width: 400,
        marginInline: "auto",
        height: "82vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
    },
    container: {
        padding: theme.paddingLG,
        display: "grid",
        gap: 32,
        borderRadius: theme.borderRadiusLG,
        boxShadow:
            "0px 9px 28px 8px #0000000D, 0px 3px 6px -4px #0000001F, 0px 6px 16px 0px #00000014",
        border: "1px solid",
        borderColor: theme.colorBorder,
    },
    formItem: {
        gap: 8,
        "& > .ant-form-item-row": {
            "& > .ant-form-item-label": {
                fontWeight: theme.fontWeightMedium,
            },
        },
    },
}))
