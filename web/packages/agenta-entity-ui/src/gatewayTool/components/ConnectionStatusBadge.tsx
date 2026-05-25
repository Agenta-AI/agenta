import {
    isConnectionActive,
    isConnectionValid,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {Tag} from "antd"

export default function ConnectionStatusBadge({connection}: {connection: ToolConnection}) {
    const isActive = isConnectionActive(connection)
    const isValid = isConnectionValid(connection)

    if (isValid && isActive) {
        return <Tag color="success">Connected</Tag>
    }
    if (!isActive) {
        return <Tag color="default">Inactive</Tag>
    }
    return <Tag color="processing">Pending</Tag>
}
