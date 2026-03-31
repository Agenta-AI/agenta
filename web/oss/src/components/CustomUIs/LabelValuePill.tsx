import React from "react"

import clsx from "clsx"
import {createUseStyles} from "react-jss"

import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {JSSTheme} from "@/oss/lib/Types"

interface LabelValuePillProps {
    label: string
    value: string
    className?: string
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    resultTag: {
        minWidth: 130,
        display: "flex",
        cursor: "pointer",
        alignItems: "stretch",
        borderRadius: theme.borderRadiusSM,
        border: `1px solid ${theme.colorBorder}`,
        textAlign: "center",
        "& > div:nth-child(1)": {
            backgroundColor: "rgba(0, 0, 0, 0.02)",
            lineHeight: theme.lineHeight,
            flex: 1,
            borderRight: `1px solid ${theme.colorBorder}`,
            padding: "0 7px",
            maxWidth: 120,
            minWidth: 120,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        "& > div:nth-child(2)": {
            padding: "0 7px",
        },
    },
}))

const LabelValuePill = ({label, value, className}: LabelValuePillProps) => {
    const classes = useStyles()
    return (
        <div className={clsx(classes.resultTag, className)}>
            <div>{label}</div>
            <div>{getStringOrJson(value)}</div>
        </div>
    )
}

export default LabelValuePill
