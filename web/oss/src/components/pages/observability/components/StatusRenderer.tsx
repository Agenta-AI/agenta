import {CheckCircleOutlined, CloseCircleOutlined, InfoCircleOutlined} from "@ant-design/icons"
import {Space, Tag, Tooltip} from "antd"

import {StatusCode} from "@/oss/services/tracing/types"

export const statusMapper = (status: StatusCode) => {
    switch (status) {
        case StatusCode.STATUS_CODE_ERROR:
            return {
                label: "failure",
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
    message,
    showMore = false,
}: {
    status?: StatusCode
    message?: string
    showMore?: boolean
}) => {
    const {label, color, icon} = statusMapper(status || StatusCode.STATUS_CODE_UNSET)
    const errorMsg = status === StatusCode.STATUS_CODE_ERROR ? message : null

    return (
        <Space>
            <Tag color={color === "default" ? undefined : color} icon={icon} className="font-mono">
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
