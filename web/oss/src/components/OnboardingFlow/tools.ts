import {
    isConnectionActive,
    isConnectionValid,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {locateTemplate} from "@agenta/entity-ui/tool-permission"
import {parseGatewayConnection, upsertGatewayConnection} from "@agenta/entity-ui/tool-utils"

export function withOnboardingTools(
    configuration: Record<string, unknown>,
    connections: ToolConnection[],
    selectedIds: string[],
) {
    const {template, wrap} = locateTemplate(configuration)
    let tools = (Array.isArray(template.tools) ? template.tools : []).filter(
        (tool) => !parseGatewayConnection(tool),
    )
    for (const id of selectedIds) {
        const connection = connections.find((item) => item.id === id)
        if (
            !connection ||
            !connection.slug ||
            !connection.provider_key ||
            !connection.integration_key ||
            !isConnectionActive(connection) ||
            !isConnectionValid(connection)
        )
            throw new Error("A selected app needs reconnecting. Go back to Connect your tools.")
        tools = upsertGatewayConnection(tools, {
            provider: connection.provider_key,
            integration: connection.integration_key,
            connection: connection.slug,
            permissions: {default: "allow", tools: {}},
        })
    }
    return wrap({...template, tools})
}
