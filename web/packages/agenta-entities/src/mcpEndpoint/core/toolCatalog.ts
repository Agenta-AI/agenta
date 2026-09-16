/**
 * An MCP server's tools, in the shape the shared permission drawer lists.
 *
 * The drawer groups a catalogue into reads and writes, labels each row, and keys every saved
 * decision. Those are three different strings and conflating them is how a permission ends up
 * stored under a name no harness uses:
 *
 * - `key` is the tool's identity, always the name the SERVER advertises (`echo`), never the
 *   harness-rendered one (`mcp__acme_prod__echo`) and never the title. It is what a policy entry is
 *   keyed by, so a catalogue that keys rows by anything else silently orphans every saved decision.
 * - `name` is what the row shows, which is the server's title when it offered one.
 * - `readOnly` decides the group. It is the server's `readOnlyHint` annotation, which is advice
 *   rather than a guarantee, so a tool that omits it lands in write: the unknown case belongs on
 *   the cautious side of the split, and `partitionToolsByAccess` already states that rule.
 */
import {mcpToolDisplayName, type McpToolSummary} from "./connectJourney"

/**
 * One catalogue row, as the drawer needs it.
 *
 * Structurally the `CatalogToolInfo` declared in `@agenta/entity-ui`'s `integrationPolicy.ts`,
 * restated here because entity-ui depends on this package and not the other way round. The
 * assignability is held by a test in entity-ui rather than asserted in a comment.
 */
export interface McpCatalogTool {
    key: string
    name?: string
    description?: string
    /** `true` is a read, `false` is a write. Absent means the server said nothing. */
    readOnly?: boolean
    /** The key is saved on the policy but the server no longer advertises it. */
    stale?: boolean
}

/** The catalogue the drawer lists, from what `tools/list` returned. */
export function toCatalogTools(tools: McpToolSummary[]): McpCatalogTool[] {
    return tools.map((tool) => {
        const readOnly = tool.annotations?.readOnlyHint
        return {
            key: tool.name,
            name: mcpToolDisplayName(tool),
            ...(tool.description !== undefined ? {description: tool.description} : {}),
            ...(readOnly !== undefined ? {readOnly} : {}),
        }
    })
}
