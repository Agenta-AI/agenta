import {
    _AgentaRootsResponse,
    AgentaNodeDTO,
    AgentaTreeDTO,
    TracesWithAnnotations,
} from "@/oss/services/observability/types"

import {uuidToSpanId, uuidToTraceId} from "../hooks/useAnnotations/assets/helpers"

const normalizeContentFields = (obj: any): void => {
    if (Array.isArray(obj)) {
        obj.forEach(normalizeContentFields)
        return
    }

    if (obj && typeof obj === "object") {
        for (const [key, value] of Object.entries(obj)) {
            if (
                key === "content" &&
                Array.isArray(value) &&
                value.length === 1 &&
                value[0]?.type === "text"
            ) {
                obj[key] = value[0].text
            } else {
                normalizeContentFields(value)
            }
        }
    }
}

export const observabilityTransformer = (
    item: AgentaTreeDTO | AgentaNodeDTO,
): _AgentaRootsResponse[] => {
    const buildData = (node: AgentaNodeDTO) => {
        normalizeContentFields(node)

        const key = node.node.id
        const hasChildren = node.nodes && Object.keys(node.nodes).length > 0

        return {
            ...node,
            key,
            // Added annotation here to make the clean up version of the annotations feature
            invocationIds: {
                trace_id: uuidToTraceId(node.root.id),
                span_id: uuidToSpanId(node.node.id),
            },
            ...(hasChildren ? {children: observabilityTransformer(node)} : undefined),
        }
    }

    if (item.nodes) {
        return Object.entries(item.nodes)
            .flatMap(([_, value]) => {
                if (Array.isArray(value)) {
                    return value.map((childNode, index) =>
                        buildData({
                            ...childNode,
                            node: {...childNode.node, name: `${childNode.node.name}[${index}]`},
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
    nodes: TracesWithAnnotations[] | TracesWithAnnotations,
    id: string,
): TracesWithAnnotations | null => {
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
