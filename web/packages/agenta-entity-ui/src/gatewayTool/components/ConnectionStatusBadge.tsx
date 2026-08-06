import {
    isConnectionActive,
    isConnectionValid,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {StatusIndicator} from "@agenta/ui/components/presentational"

export default function ConnectionStatusBadge({connection}: {connection: ToolConnection}) {
    const isActive = isConnectionActive(connection)
    const isValid = isConnectionValid(connection)

    if (isValid && isActive) {
        return <StatusIndicator tone="success" label="Connected" />
    }
    if (!isActive) {
        return <StatusIndicator tone="default" label="Inactive" />
    }
    return <StatusIndicator tone="processing" label="Pending" />
}
