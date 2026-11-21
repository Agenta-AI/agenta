import {
    isConnectionActive,
    isConnectionValid,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {useT} from "@agenta/i18n"
import toolConnectionsCatalog from "@agenta/i18n/catalogs/entityUi.toolConnections"
import {StatusIndicator} from "@agenta/ui/components/presentational"

export default function ConnectionStatusBadge({connection}: {connection: ToolConnection}) {
    const t = useT(toolConnectionsCatalog)
    const isActive = isConnectionActive(connection)
    const isValid = isConnectionValid(connection)

    if (isValid && isActive) {
        return <StatusIndicator tone="success" label={t("entityUi.toolConnections.connected")} />
    }
    if (!isActive) {
        return <StatusIndicator tone="default" label={t("entityUi.toolConnections.inactive")} />
    }
    return <StatusIndicator tone="warning" label={t("entityUi.toolConnections.pending")} />
}
