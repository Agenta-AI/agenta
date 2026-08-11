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
    if (nodes && !Array.isArray(nodes) && nodes.span_id === id) {
        return nodes
    }

    if (nodes) {
        for (const value of Object.values(nodes) as (T | T[])[]) {
            if (Array.isArray(value)) {
                for (const node of value) {
                    if (node.span_id === id) {
                        return node
                    }

                    if (node.children) {
                        const foundNode = getNodeById(node.children as T[], id)
                        if (foundNode) return foundNode
                    }
                }
            } else {
                if (value?.span_id === id) {
                    return value
                }

                if (value?.children) {
                    const foundNode = getNodeById(value.children as T[], id)
                    if (foundNode) return foundNode
                }
            }
        }
    }
    return null
}
