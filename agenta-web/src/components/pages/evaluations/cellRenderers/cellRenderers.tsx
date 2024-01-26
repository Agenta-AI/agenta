import {useDurationCounter} from "@/hooks/useDurationCounter"
import {
    EvaluationStatus,
    EvaluatorConfig,
    JSSTheme,
    _Evaluation,
    _EvaluationScenario,
} from "@/lib/Types"
import {
    CopyOutlined,
    FullscreenExitOutlined,
    FullscreenOutlined,
    InfoCircleOutlined,
} from "@ant-design/icons"
import {ICellRendererParams} from "ag-grid-community"
import {GlobalToken, Space, Tooltip, Typography, message, theme} from "antd"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import duration from "dayjs/plugin/duration"
import Link from "next/link"
import React, {useCallback, useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {getTypedValue} from "@/lib/helpers/evaluate"
dayjs.extend(relativeTime)
dayjs.extend(duration)

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
    longCell: {
        height: "100%",
        position: "relative",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        "& .ant-space": {
            position: "absolute",
            bottom: 2,
            right: 0,
            height: 35,
            backgroundColor: theme.colorBgContainer,
            padding: "0.5rem",
            borderRadius: theme.borderRadius,
            border: `1px solid ${theme.colorBorder}`,
            display: "none",
        },
        "&:hover .ant-space": {
            display: "inline-flex",
        },
    },
}))

export function LongTextCellRenderer(params: ICellRendererParams) {
    const {value, api, node} = params
    const [expanded, setExpanded] = useState(
        node.rowHeight !== api.getSizesForCurrentTheme().rowHeight,
    )
    const classes = useStyles()

    const onCopy = useCallback(() => {
        navigator.clipboard
            .writeText(value as string)
            .then(() => {
                message.success("Copied to clipboard")
            })
            .catch(console.error)
    }, [])

    const onExpand = useCallback(() => {
        const cells = document.querySelectorAll(`[row-id='${node.id}'] .ag-cell > *`)
        const cellsArr = Array.from(cells || [])
        const defaultHeight = api.getSizesForCurrentTheme().rowHeight
        if (!expanded) {
            cellsArr.forEach((cell) => {
                cell.setAttribute(
                    "style",
                    "overflow: visible; white-space: pre-wrap; text-overflow: unset;",
                )
            })
            const height = Math.max(...cellsArr.map((cell) => cell.scrollHeight))
            node.setRowHeight(height <= defaultHeight ? defaultHeight * 2 : height)
        } else {
            cellsArr.forEach((cell) => {
                cell.setAttribute(
                    "style",
                    "overflow: hidden; white-space: nowrap; text-overflow: ellipsis;",
                )
            })
            node.setRowHeight(defaultHeight)
        }
        api.onRowHeightChanged()
    }, [expanded])

    useEffect(() => {
        node.addEventListener("heightChanged", () => {
            setExpanded(node.rowHeight !== api.getSizesForCurrentTheme().rowHeight)
        })
    }, [])

    return (
        <div
            className={classes.longCell}
            style={expanded ? {textWrap: "wrap", lineHeight: "2em", paddingTop: 6.5} : undefined}
        >
            {value}
            <Space align="center" size="middle">
                {expanded ? (
                    <FullscreenExitOutlined onClick={onExpand} />
                ) : (
                    <FullscreenOutlined onClick={onExpand} />
                )}
                <CopyOutlined onClick={onCopy} />
            </Space>
        </div>
    )
}

export const ResultRenderer = React.memo(
    (params: ICellRendererParams<_EvaluationScenario> & {config: EvaluatorConfig}) => {
        const result = params.data?.results.find(
            (item) => item.evaluator_config === params.config.id,
        )?.result
        let errorMsg = ""
        if (result.type === "error") {
            errorMsg = `${result?.error?.message}\n${result?.error?.stacktrace}`
        }

        return (
            <Typography.Text type={errorMsg ? "danger" : undefined}>
                {errorMsg || getTypedValue(result)}
            </Typography.Text>
        )
    },
    (prev, next) => prev.value === next.value,
)

export const runningStatuses = [EvaluationStatus.INITIALIZED, EvaluationStatus.STARTED]
export const statusMapper = (token: GlobalToken) => ({
    [EvaluationStatus.INITIALIZED]: {
        label: "Queued",
        color: token.colorTextSecondary,
    },
    [EvaluationStatus.STARTED]: {
        label: "Running",
        color: token.colorWarning,
    },
    [EvaluationStatus.FINISHED]: {
        label: "Completed",
        color: token.colorSuccess,
    },
    [EvaluationStatus.ERROR]: {
        label: "Failed",
        color: token.colorError,
    },
    [EvaluationStatus.FINISHED_WITH_ERRORS]: {
        label: "Completed with Errors",
        color: token.colorWarning,
    },
})
export const StatusRenderer = React.memo(
    (params: ICellRendererParams<_Evaluation>) => {
        const classes = useStyles()
        const {token} = theme.useToken()
        const duration = useDurationCounter(
            params.data?.duration || 0,
            runningStatuses.includes(params.value),
        )
        const {label, color} = statusMapper(token)[params.value.value as EvaluationStatus]
        const errorMsg = params.data?.status.error?.message

        return (
            <Typography.Text className={classes.statusCell}>
                <div style={{backgroundColor: color}} />
                <span>{label}</span>
                {errorMsg && (
                    <span style={{marginRight: 2}}>
                        <Tooltip title={errorMsg}>
                            <InfoCircleOutlined />
                        </Tooltip>
                    </span>
                )}
                <span className={classes.dot}></span>
                <span className={classes.date}>{duration}</span>
            </Typography.Text>
        )
    },
    (prev, next) => prev.value === next.value && prev.data?.duration === next.data?.duration,
)

export const LinkCellRenderer = React.memo(
    (params: ICellRendererParams & {href: string}) => {
        const {value, href} = params
        return <Link href={href}>{value}</Link>
    },
    (prev, next) => prev.value === next.value && prev.href === next.href,
)

export const DateFromNowRenderer = React.memo(
    (params: ICellRendererParams) => {
        const [date, setDate] = useState(params.value)

        useEffect(() => {
            const interval = setInterval(() => {
                setDate((date: any) => dayjs(date).add(1, "second").valueOf())
            }, 60000)
            return () => clearInterval(interval)
        }, [])

        return <Typography.Text>{dayjs(date).fromNow()}</Typography.Text>
    },
    (prev, next) => prev.value === next.value,
)
