import {createUseStyles} from "react-jss"

import type {StyleProps, JSSTheme} from "@/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: ({themeMode}: StyleProps) => ({
        width: "100%",
        color: themeMode === "dark" ? "#fff" : "#000",
        "& h1.ant-typography": {
            fontSize: theme.fontSizeHeading2,
            fontWeight: theme.fontWeightMedium,
            lineHeight: theme.lineHeightHeading2,
        },
        "& h2.ant-typography": {
            fontSize: theme.fontSizeHeading3,
            fontWeight: theme.fontWeightMedium,
            lineHeight: theme.lineHeightHeading3,
        },
        "& span.ant-typography": {
            fontSize: theme.fontSizeLG,
            lineHeight: theme.lineHeightLG,
            color: "inherit",
        },
    }),
}))
