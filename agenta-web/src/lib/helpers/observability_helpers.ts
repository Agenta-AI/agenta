import {_AgentaRootsResponse} from "@/services/observability/types"

export const getNodeById = (
    nodes: _AgentaRootsResponse[] | _AgentaRootsResponse,
    id: string,
): _AgentaRootsResponse | null => {
    if (nodes && !Array.isArray(nodes) && nodes.key === id) {
        return nodes
    }

    if (nodes) {
        for (const value of Object.values(nodes)) {
            if (Array.isArray(value)) {
                for (const node of value) {
                    if (node.key === id) {
                        return node
                    }

                    if (node.children) {
                        const foundNode = getNodeById(node.children, id)
                        if (foundNode) return foundNode
                    }
                }
            } else {
                if (value.key === id) {
                    return value
                }

                if (value.children) {
                    const foundNode = getNodeById(value.children, id)
                    if (foundNode) return foundNode
                }
            }
        }
    }
    return null
}
