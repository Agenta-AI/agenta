import {_AgentaRootsResponse, AgentaNodeDTO, AgentaTreeDTO} from "@/services/observability/types"

export const observabilityTransformer = (
    item: AgentaTreeDTO | AgentaNodeDTO,
): _AgentaRootsResponse[] => {
    const buildData = (node: AgentaNodeDTO) => {
        const key = node.node.id
        const hasChildren = node.nodes && Object.keys(node.nodes).length > 0

        return {
            ...node,
            key,
            ...(hasChildren ? {children: observabilityTransformer(node)} : undefined),
        }
    }

    if (item.nodes) {
        return Object.entries(item.nodes)
            .flatMap(([_, value]) => {
                if (Array.isArray(value)) {
                    return value.map((item, index) =>
                        buildData({
                            ...item,
                            node: {...item.node, name: `${item.node.name}[${index}]`},
                        }),
                    )
                } else {
                    return buildData(value)
                }
            })
            .filter((node): node is _AgentaRootsResponse => node !== null && node !== undefined)
    }

    return []
}

export const buildNodeTree = ({parent, ...node}: AgentaNodeDTO) => ({
    tree: node.tree.id,
    nodes: [{...node}],
})

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
