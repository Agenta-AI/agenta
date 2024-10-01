import {JSSTheme} from "@/lib/Types"
import React from "react"
import {createUseStyles} from "react-jss"

interface ResultTagProps {
    title: string
    value: any
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    resultTag: {
        display: "flex",
        borderRadius: theme.borderRadiusSM,
        border: `1px solid ${theme.colorBorder}`,
        width: "fit-content",
        textAlign: "center",
        "& > div:nth-child(1)": {
            backgroundColor: "rgba(0, 0, 0, 0.02)",
            lineHeight: theme.lineHeight,
            flex: 1,
            minWidth: 50,
            borderRight: `1px solid ${theme.colorBorder}`,
            padding: "0 7px",
        },
        "& > div:nth-child(2)": {
            padding: "0 7px",
        },
    },
}))

const ResultTag = ({title, value}: ResultTagProps) => {
    const classes = useStyles()

    return (
        <div className={classes.resultTag}>
            <div>{title}</div>
            <div>{JSON.stringify(value)}</div>
        </div>
    )
}

export default ResultTag
