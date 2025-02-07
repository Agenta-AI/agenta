import {_AgentaRootsResponse, NodeStatusCode, NodeStatusDTO} from "@/services/observability/types"
import {CheckCircleOutlined, CloseCircleOutlined, InfoCircleOutlined} from "@ant-design/icons"
import {Space, Tag, Tooltip} from "antd"
import React from "react"

export const statusMapper = (status: NodeStatusCode) => {
    switch (status) {
        case NodeStatusCode.ERROR:
            return {
                label: "failed",
                color: "error",
                icon: <CloseCircleOutlined />,
            }
        default:
            return {
                label: "success",
                color: "success",
                icon: <CheckCircleOutlined />,
            }
    }
}

const StatusRenderer = ({
    status,
    showMore = false,
}: {
    status?: NodeStatusDTO
    showMore?: boolean
}) => {
    const {label, color, icon} = statusMapper(status?.code)
    const errorMsg = status?.code === NodeStatusCode.ERROR ? status?.message : null

    return (
        <Space align="center" size={0}>
            <Tag color={color} icon={icon}>
                {label}
            </Tag>
            {showMore && errorMsg && (
                <Tooltip title={errorMsg} placement="bottom">
                    <InfoCircleOutlined />
                </Tooltip>
            )}
        </Space>
    )
}

export default StatusRenderer
