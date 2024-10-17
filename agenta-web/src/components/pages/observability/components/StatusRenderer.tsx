import {_AgentaRootsResponse, NodeStatusCode, NodeStatusDTO} from "@/services/observability/types"
import {InfoCircleOutlined} from "@ant-design/icons"
import {Space, Tag, Tooltip} from "antd"
import React from "react"

export const statusMapper = (status: NodeStatusCode) => {
    switch (status) {
        case NodeStatusCode.UNSET:
            return {
                label: "initiated",
                color: "processing",
            }
        case NodeStatusCode.ERROR:
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

const StatusRenderer = (status: NodeStatusDTO) => {
    const {label, color} = statusMapper(status.code)
    const errorMsg = status.code === NodeStatusCode.ERROR ? status.message : null

    return (
        <Space align="center" size={0}>
            <Tag color={color}>{label}</Tag>
            {errorMsg && (
                <Tooltip title={errorMsg} placement="bottom">
                    <InfoCircleOutlined />
                </Tooltip>
            )}
        </Space>
    )
}

export default StatusRenderer
