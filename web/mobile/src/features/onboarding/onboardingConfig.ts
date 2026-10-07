import {
    isConnectionActive,
    isConnectionValid,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {locateTemplate} from "@agenta/entity-ui/tool-permission"
import {parseGatewayConnection, upsertGatewayConnection} from "@agenta/entity-ui/tool-utils"

/** Zero-auth Composio integrations every new workspace starts with; they join every first agent. */
export const SEED_TOOLS = [
    {key: "composio_search", name: "Composio Search"},
    {key: "browser_tool", name: "Browser Tool"},
] as const

const SEED_KEYS: ReadonlySet<string> = new Set(SEED_TOOLS.map((tool) => tool.key))

/** A connection the runner can use: active, valid, and fully addressed. */
export const isUsableToolConnection = (connection: ToolConnection) =>
    Boolean(
        connection.slug &&
        connection.provider_key &&
        connection.integration_key &&
        isConnectionActive(connection) &&
        isConnectionValid(connection),
    )

/** The draft agent's config with the chosen apps and the seeded tools as its gateway tools. */
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
        if (!key || !(chosen.has(key) || SEED_KEYS.has(key))) continue
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
