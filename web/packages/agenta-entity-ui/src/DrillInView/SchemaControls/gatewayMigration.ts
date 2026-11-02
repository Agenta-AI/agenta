/**
 * Migration from the legacy per-action gateway entries to one `gateway_connection` entry.
 *
 * The frontend owns this migration. There is no Python twin.
 *
 * Two legacy encodings exist in saved revisions and both must be read: the canonical
 * `{type: "gateway", action, ...}` object, and a function entry whose `function.name` is the
 * five-segment slug. `parseGatewayTool` normalizes both, so this module works on its view.
 *
 * Migration runs on an AUTHOR ACTION — opening an integration's permission drawer — never on a page
 * load, so viewing an untouched agent never rewrites it.
 *
 * An integration is migrated only when all of its legacy entries name ONE connection. The saved
 * format allows one entry per provider and integration, so grouping entries that span two
 * connections would produce two entries for one integration, which validation rejects. Guessing
 * which connection the author meant, and dropping the entries for the connection not picked, are
 * both worse than leaving that integration alone, so it keeps its legacy entries and its badge.
 */
import {
    buildGatewayConnectionEntry,
    buildIntegrationRows,
    findIntegrationRow,
    isGatewayPermission,
    parseGatewayTool,
    type GatewayConnectionTarget,
    type GatewayPermission,
    type IntegrationRow,
} from "./toolUtils"

/**
 * Whether folding this row's legacy entries into one connection entry is both possible and safe.
 * It is not when the integration already has a connection entry: merging the old per-tool values
 * into a policy the author has since set would change that policy, so both are left as they are.
 */
export function canMigrateIntegration(row: IntegrationRow | undefined): row is IntegrationRow {
    if (!row || row.entry) return false
    return row.legacyIndices.length > 0 && row.legacyConnections.length === 1
}

/**
 * Fold one integration's legacy entries into a single `gateway_connection` entry, or return null
 * when nothing changes. The new entry takes the position of the first legacy entry, so the tools
 * list keeps its order.
 *
 * The new default is `deny`: a legacy revision listed exactly the tools the author chose, so every
 * tool it did not list must stay unavailable. Each old `permission` is copied into the tool map,
 * and an old entry that carried none becomes `inherit`.
 */
export function migrateIntegration(
    tools: unknown[],
    target: GatewayConnectionTarget,
): unknown[] | null {
    const row = findIntegrationRow(buildIntegrationRows(tools), target)
    if (!canMigrateIntegration(row)) return null

    const toolPermissions: Record<string, GatewayPermission> = {}
    for (const index of row.legacyIndices) {
        const view = parseGatewayTool(tools[index])
        if (!view) continue
        // A revision can list the same action twice. Keep the first, so the result does not depend
        // on array order; letting the last win would silently pick one of two authored values.
        if (view.action in toolPermissions) continue
        toolPermissions[view.action] = isGatewayPermission(view.permission)
            ? view.permission
            : "inherit"
    }

    const entry = buildGatewayConnectionEntry({
        provider: row.provider,
        integration: row.integration,
        connection: row.legacyConnections[0],
        permissions: {default: "deny", tools: toolPermissions},
    })

    const dropped = new Set(row.legacyIndices)
    const first = row.legacyIndices[0]
    const next: unknown[] = []
    tools.forEach((tool, index) => {
        if (index === first) next.push(entry)
        else if (!dropped.has(index)) next.push(tool)
    })
    return next
}
