import {TraceSpan, TraceSpanStatus} from "@/lib/Types"
import {InfoCircleOutlined} from "@ant-design/icons"
import {Space, Tag, Tooltip} from "antd"
import React from "react"

export const statusMapper = (status: TraceSpanStatus) => {
    switch (status) {
        case TraceSpanStatus.UNSET:
            return {
                label: "initiated",
                color: "processing",
            }
        case TraceSpanStatus.ERROR:
            return {
                label: "failed",
                color: "error",
            }
        default:
            return {
                label: "success",
                color: "success",
            }
    }
}

export const StatusRenderer = React.memo(
    ({data}: {data: TraceSpan}) => {
        const {label, color} = statusMapper(data.status)
        const errorMsg = data.status === "ERROR" ? data?.error : null

        return (
            <Space align="center" size={0}>
                <Tag color={color}>{label}</Tag>
                {errorMsg && (
                    <Tooltip title={errorMsg}>
                        <InfoCircleOutlined />
                    </Tooltip>
                )}
            </Space>
        )
    },
    (prevProps, nextProps) => {
        return prevProps.data === nextProps.data
    },
)
