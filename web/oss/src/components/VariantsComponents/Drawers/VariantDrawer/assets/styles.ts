import {createUseStyles} from "react-jss"

import type {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    subTitle: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
        fontWeight: theme.fontWeightMedium,
    },
    promptTextField: {
        padding: theme.paddingXS,
        backgroundColor: theme.colorBgContainerDisabled,
        borderRadius: theme.borderRadius,
    },
    noParams: {
        color: theme.colorTextDescription,
        fontWeight: theme.fontWeightMedium,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 200,
    },
}))
