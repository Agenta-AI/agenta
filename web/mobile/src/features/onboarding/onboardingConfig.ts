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

/** The draft agent's config with the chosen apps as its gateway tools. */
export const onboardingConfiguration = (
    configuration: Record<string, unknown>,
    {apps, connections}: {apps: readonly string[]; connections: readonly ToolConnection[]},
): Record<string, unknown> => {
    const {template, wrap} = locateTemplate(configuration)
    const chosen = new Set(apps)
    let tools = (Array.isArray(template.tools) ? template.tools : []).filter(
        (tool) => !parseGatewayConnection(tool),
    )
    for (const connection of connections) {
        const key = connection.integration_key
        if (!key || !chosen.has(key)) continue
        if (!isUsableToolConnection(connection)) continue
        tools = upsertGatewayConnection(tools, {
            provider: connection.provider_key!,
            integration: key,
            connection: connection.slug!,
            permissions: {default: "allow", tools: {}},
        })
    }
    return wrap({...template, tools})
}
