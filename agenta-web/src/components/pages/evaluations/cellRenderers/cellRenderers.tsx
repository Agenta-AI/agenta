import {useDurationCounter} from "@/hooks/useDurationCounter"
import {EvaluationStatus, JSSTheme, _Evaluation} from "@/lib/Types"
import {CopyOutlined, FullscreenExitOutlined, FullscreenOutlined} from "@ant-design/icons"
import {ICellRendererParams} from "ag-grid-community"
import {GlobalToken, Space, Typography, message, theme} from "antd"
import Link from "next/link"
import React, {useCallback, useEffect, useState} from "react"
import {createUseStyles} from "react-jss"

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
        node.setRowHeight(api.getSizesForCurrentTheme().rowHeight * (expanded ? 1 : 5))
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
})
export const StatusRenderer = React.memo(
    (params: ICellRendererParams<_Evaluation>) => {
        const classes = useStyles()
        const {token} = theme.useToken()
        const duration = useDurationCounter(
            params.data?.duration || 0,
            runningStatuses.includes(params.value),
        )
        const {label, color} = statusMapper(token)[params.value as EvaluationStatus]

        return (
            <Typography.Text className={classes.statusCell}>
                <div style={{backgroundColor: color}} />
                <span>{label}</span>
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
