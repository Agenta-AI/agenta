import {TraceSpanNode} from "@/oss/services/tracing/types"

export const filterTree = (node: TraceSpanNode, search: string) => {
    const nameMatches = node.span_name?.toLowerCase().includes(search.toLowerCase())

    const filteredChildren = (node.children || [])
        .map((child) => filterTree(child, search))
        .filter(Boolean) as TraceSpanNode[]

    if (nameMatches || filteredChildren.length > 0) {
        return {
            ...node,
            children: filteredChildren,
        }
    }

    return null
}
