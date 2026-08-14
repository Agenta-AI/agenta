import {sortSpansByStartTime} from "@agenta/entities/trace"
import {uuidToSpanId, uuidToTraceId} from "@agenta/shared/utils"

import {_AgentaRootsResponse, AgentaNodeDTO, AgentaTreeDTO} from "./legacyObservabilityTypes"

const normalizeContentFields = (obj: unknown): void => {
    if (Array.isArray(obj)) {
        obj.forEach(normalizeContentFields)
        return
    }

    if (obj && typeof obj === "object") {
        const record = obj as Record<string, unknown>
        for (const [key, value] of Object.entries(record)) {
            if (
                key === "content" &&
                Array.isArray(value) &&
                value.length === 1 &&
                value[0]?.type === "text"
            ) {
                if (Array.isArray(record[key])) {
                    for (const item of record[key] as unknown[]) {
                        normalizeContentFields(item)
                    }
                } else {
                    record[key] = (value[0] as {text?: unknown}).text
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
