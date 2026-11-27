import type {TraceSpanNode} from "../core/traceSpan"

/**
 * Span-tree shaping, shared by the desktop trace drawer and the mobile trace list.
 *
 * Both filters return a NEW tree and never mutate the input, because the drawer keeps the
 * unfiltered tree around to restore when the search box is cleared.
 */

/**
 * Narrows a tree to spans whose name matches, keeping every ancestor that leads to a match.
 * `labelOf` gives the label a row shows in place of the name (a tool span's step); it matches too.
 */
export const filterTree = (
    node: TraceSpanNode,
    search: string,
    labelOf?: (node: TraceSpanNode) => string | null,
): TraceSpanNode | null => {
    const needle = search.toLowerCase()
    const nameMatches =
        node.span_name?.toLowerCase().includes(needle) ||
        labelOf?.(node)?.toLowerCase().includes(needle)

    const filteredChildren = (node.children || [])
        .map((child) => filterTree(child, search, labelOf))
        .filter(Boolean) as TraceSpanNode[]

    if (nameMatches || filteredChildren.length > 0) {
        return {
            ...node,
            children: filteredChildren,
        }
    }

    return null
}
