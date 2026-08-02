import {
    isConnectionActive,
    isConnectionValid,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {Tag} from "@agenta/ui/components/presentational"

export default function ConnectionStatusBadge({connection}: {connection: ToolConnection}) {
    const isActive = isConnectionActive(connection)
    const isValid = isConnectionValid(connection)

    if (isValid && isActive) {
        return <Tag tone="success">Connected</Tag>
    }
    if (!isActive) {
        return <Tag tone="default">Inactive</Tag>
    }
    return <Tag tone="processing">Pending</Tag>
}
