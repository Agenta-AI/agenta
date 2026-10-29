/**
 * Finding one tool in a real server's catalogue.
 *
 * The mock advertises three. Linear advertises seventy-nine, and both lists that show them —
 * the read-only one in the connection drawer and the permission editor in an agent's
 * configuration — render every row, so choosing what one tool may do meant scrolling for it.
 */
import type {McpToolSummary} from "./connectJourney"

/** Below this a filter box is more in the way than the scrolling it saves. */
export const TOOL_FILTER_THRESHOLD = 8

/**
 * The tools a query names.
 *
 * Name, title and description, because a person looking for "the one that files an issue" knows
 * what it does rather than what it is called. Case and surrounding space are ignored; an empty
 * query is not a filter and returns everything.
 *
 * The title is searched because the row shows it: a list that hides the row a person can read
 * the typed text in is a list that says the tool is not there. Every field a row can display is
 * a field the filter matches, which is the rule description matching already established.
 */
export const filterMcpTools = <T extends McpToolSummary>(tools: T[], query: string): T[] => {
    const needle = query.trim().toLowerCase()
    if (!needle) return tools
    return tools.filter(
        (tool) =>
            tool.name.toLowerCase().includes(needle) ||
            (tool.title ?? "").toLowerCase().includes(needle) ||
            (tool.annotations?.title ?? "").toLowerCase().includes(needle) ||
            (tool.description ?? "").toLowerCase().includes(needle),
    )
}
