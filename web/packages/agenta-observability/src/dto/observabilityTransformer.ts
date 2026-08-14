import {sortSpansByStartTime} from "@agenta/entities/trace"
import {uuidToSpanId, uuidToTraceId} from "@agenta/shared/utils"

import {
    _AgentaRootsResponse,
    AgentaNodeDTO,
    AgentaTreeDTO,
} from "@/oss/services/observability/types"

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
                if (Array.isArray(obj[key])) {
                    for (const item of obj[key]) {
                        normalizeContentFields(item)
                    }
                } else {
                    obj[key] = value[0].text
                }
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

        const key = node?.node?.id || node?.span_id
        const hasChildren = node?.nodes && Object.keys(node.nodes).length > 0

        return {
            ...node,
            key,
            // Added annotation here to make the clean up version of the annotations feature
            invocationIds: {
                trace_id: uuidToTraceId(node?.root?.id) || node?.trace_id,
                span_id: uuidToSpanId(node?.node?.id) || node?.span_id,
            },
            ...(hasChildren ? {children: observabilityTransformer(node)} : undefined),
        }
    }

    if (item.nodes) {
        const children = Object.entries(item.nodes)
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

        // Sort children at this hierarchy level by start_time
        return sortSpansByStartTime(children)
    }

    return []
}

export const buildNodeTree = ({parent, ...node}: AgentaNodeDTO) => ({
    tree: node?.tree?.id || node?.trace_id,
    nodes: [{...node}],
})
