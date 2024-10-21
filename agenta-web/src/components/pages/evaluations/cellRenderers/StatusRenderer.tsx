import {useDurationCounter} from "@/hooks/useDurationCounter"
import {_Evaluation, EvaluationStatus, JSSTheme} from "@/lib/Types"
import {InfoCircleOutlined} from "@ant-design/icons"
import {theme, Tooltip, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"
import {runningStatuses, statusMapper} from "./cellRenderers"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    statusCell: {
        display: "flex",
        alignItems: "center",
        gap: "0.25rem",
        height: "100%",
        marginBottom: 0,

        "& > div:nth-of-type(1)": {
            height: 6,
            aspectRatio: 1 / 1,
            borderRadius: "50%",
        },
    },
    dot: {
        height: 3,
        aspectRatio: 1 / 1,
        borderRadius: "50%",
        backgroundColor: "#8c8c8c",
        marginTop: 2,
    },
    date: {
        color: "#8c8c8c",
    },
}))

const StatusRenderer = (record: _Evaluation) => {
    const classes = useStyles()
    const {token} = theme.useToken()
    const value = record.status.value
    const duration = useDurationCounter(record.duration || 0, runningStatuses.includes(value))
    const {label, color} = statusMapper(token)(record.status.value as EvaluationStatus)
    const errorMsg = record.status.error?.message
    const errorStacktrace = record.status.error?.stacktrace

    return (
        <Typography.Text className={classes.statusCell} data-cy="evaluation-status-cell">
            <div style={{backgroundColor: color}} />
            <span>{label}</span>
            {errorMsg && (
                <span style={{marginRight: 2}}>
                    <Tooltip title={errorStacktrace ? errorStacktrace : ""}>
                        <InfoCircleOutlined />
                    </Tooltip>
                </span>
            )}
            <span className={classes.dot}></span>
            <span className={classes.date}>{duration}</span>
        </Typography.Text>
    )
}

export default StatusRenderer
