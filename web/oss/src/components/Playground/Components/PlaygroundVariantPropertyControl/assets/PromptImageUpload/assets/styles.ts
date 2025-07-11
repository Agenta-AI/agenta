import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    uploadDragger: {
        width: "100%",
        border: "1px dashed #BDC7D1",
        display: "flex",
        alignItems: "center",
        gap: 16,
        "& .ant-upload-drag": {
            background: "transparent",
            border: "none",
        },
        "& .ant-upload-btn": {
            padding: "0 !important",
        },
    },
}))
