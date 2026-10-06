import {
    isConnectionActive,
    isConnectionValid,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {locateTemplate} from "@agenta/entity-ui/tool-permission"
import {parseGatewayConnection, upsertGatewayConnection} from "@agenta/entity-ui/tool-utils"

/** A connection the runner can use: active, valid, and fully addressed. */
export const isUsableToolConnection = (connection: ToolConnection) =>
    Boolean(
        connection.slug &&
        connection.provider_key &&
        connection.integration_key &&
        isConnectionActive(connection) &&
        isConnectionValid(connection),
    )

/** Connected means in the agent: every usable connection becomes a gateway tool, once. */
export const withOnboardingTools = (
    configuration: Record<string, unknown>,
    connections: readonly ToolConnection[],
): Record<string, unknown> => {
    const {template, wrap} = locateTemplate(configuration)
    let tools = (Array.isArray(template.tools) ? template.tools : []).filter(
        (tool) => !parseGatewayConnection(tool),
    )
    for (const connection of connections) {
        if (!isUsableToolConnection(connection)) continue
        tools = upsertGatewayConnection(tools, {
            provider: connection.provider_key!,
            integration: connection.integration_key!,
            connection: connection.slug!,
            permissions: {default: "allow", tools: {}},
        })
    }
    return wrap({...template, tools})
}
