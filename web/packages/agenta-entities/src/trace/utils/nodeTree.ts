/**
 * Span-tree traversal.
 *
 * Generic over the node type so callers keep their own span shape (OSS's
 * annotation-carrying `TraceSpanNode`, the packaged one, or a session node).
 */

interface SpanNodeLike {
    span_id?: string
    children?: unknown
}

export const getNodeById = <T extends SpanNodeLike>(
    nodes: T[] | T | null | undefined,
    id: string,
): T | null => {
    if (!nodes) return null

    // Only `children` is traversed. Iterating `Object.values(node)` also walked metadata such as
    // `invocationIds` and `otel.links`, which carry a `span_id` of their own — so a lookup could
    // return a link bag instead of the span it belongs to.
    const roots = Array.isArray(nodes) ? nodes : [nodes]

    for (const node of roots) {
        if (!node) continue
        if (node.span_id === id) return node

        const children = node.children
        if (Array.isArray(children)) {
            const found = getNodeById(children as T[], id)
            if (found) return found
        }
    }

    return null
}
