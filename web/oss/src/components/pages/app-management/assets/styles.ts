import {createUseStyles} from "react-jss"

import type {StyleProps} from "@/oss/lib/Types"

export const useStyles = createUseStyles(() => ({
    container: ({themeMode}: StyleProps) => ({
        width: "100%",
        color: themeMode === "dark" ? "#fff" : "#000",
    }),
}))
