import {AgentaNodeDTO} from "@/services/observability/types"

export const findTraceNodeById = (
    nodes: Record<string, AgentaNodeDTO | AgentaNodeDTO[]> | undefined,
    id: string,
): AgentaNodeDTO | null => {
    for (const key in nodes) {
        const node = nodes[key]

        if (Array.isArray(node)) {
            for (const childNode of node) {
                if (childNode.node.id === id) {
                    return childNode
                }

                const found = findTraceNodeById(
                    childNode.nodes as Record<string, AgentaNodeDTO | AgentaNodeDTO[]>,
                    id,
                )
                if (found) return found
            }
        } else {
            if (node.node.id === id) {
                return node
            }

            if (node.nodes) {
                const found = findTraceNodeById(
                    node.nodes as Record<string, AgentaNodeDTO | AgentaNodeDTO[]>,
                    id,
                )
                if (found) return found
            }
        }
    }
    return null
}
