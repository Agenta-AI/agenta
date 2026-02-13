import {TraceSpan} from "@/oss/lib/Types"
import {AgentaNodeDTO} from "@/oss/services/observability/types"

export const fromBaseResponseToTraceSpanType = (
    spans: any[],
    traceId: string,
): [TraceSpan[], Record<string, TraceSpan>] => {
    const TRACE_DEFAULT_KEY = "__default__"

    const all_spans = spans.map((span) => ({
        id: span.id,
        name: span.name,
        created_at: span.start_time,
        variant: {
            variant_id: span.variant_id || null,
            variant_name: span.variant_name || null,

            revision:
                span.environment == "playground"
                    ? null
                    : span.config
                      ? span.config?.revision
                      : null,
        },
        environment: span.environment || null,
        spankind: span.spankind,
        status: span.status,
        metadata: {
            cost: span.cost,
            latency:
                (new Date(span.end_time).getTime() - new Date(span.start_time).getTime()) / 1000,
            usage: span.tokens,
        },
        content: {
            inputs: span.inputs,
            internals: span.internals,
            outputs:
                Array.isArray(span.outputs) ||
                span.outputs == undefined ||
                !span.outputs.hasOwnProperty(TRACE_DEFAULT_KEY)
                    ? span.outputs
                    : span.outputs[TRACE_DEFAULT_KEY],
        } as {
            inputs: Record<string, any> | null
            internals: Record<string, any> | null
            outputs: string[] | Record<string, any> | null
        },
        user_id: span.user,
        trace_id: traceId,
        parent_span_id: span.parent_span_id,

        children: null,
    }))

    const spans_dict: Record<string, TraceSpan> = {}
    for (const span of all_spans) {
        spans_dict[span.id] = span
    }

    const child_spans: string[] = []

    for (const span of all_spans) {
        if (span.parent_span_id) {
            const parent_span: TraceSpan = spans_dict[span.parent_span_id]
            const child_span: TraceSpan = spans_dict[span.id]

            if (parent_span) {
                if (parent_span?.children === null) {
                    parent_span.children = []
                }

                parent_span.children?.push(child_span)
                child_spans.push(child_span.id)
            }
        }
    }

    const top_level_spans: TraceSpan[] = all_spans.filter((span) => !child_spans.includes(span.id))

    return [top_level_spans, spans_dict]
}

export const transformTraceTreeToJson = (tree: TraceSpan[]) => {
    const nodeMap: Record<string, any> = {}

    function addTree(item: TraceSpan) {
        if (item.name) {
            const content = {
                ...item.content,
                ...(item.children ? transformTraceTreeToJson(item.children) : null),
            }

            if (!nodeMap[item.name]) {
                nodeMap[item.name] = content
            } else {
                if (!Array.isArray(nodeMap[item.name])) {
                    nodeMap[item.name] = [nodeMap[item.name]]
                }
                nodeMap[item.name].push(content)
            }
        }
    }

    tree.forEach((item) => {
        addTree(item)
    })

    const filterEmptyValues = (obj: Record<string, any>): any => {
        if (Array.isArray(obj)) {
            return obj
                .map(filterEmptyValues)
                .filter(
                    (item) =>
                        item !== null &&
                        !(typeof item === "object" && Object.keys(item).length === 0),
                )
        } else if (typeof obj === "object" && obj !== null) {
            return Object.entries(obj).reduce(
                (acc, [key, value]) => {
                    const filteredValue = filterEmptyValues(value)
                    if (
                        filteredValue !== null &&
                        !(
                            typeof filteredValue === "object" &&
                            Object.keys(filteredValue).length === 0
                        )
                    ) {
                        acc[key] = filteredValue
                    }
                    return acc
                },
                {} as Record<string, any>,
            )
        } else {
            return obj
        }
    }

    return filterEmptyValues(nodeMap)
}

export const generatePaths = (obj: Record<string, any>, currentPath = "") => {
    let paths: {value: string}[] = []

    if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
        Object.entries(obj).forEach(([key, value]) => {
            const newPath = currentPath ? `${currentPath}.${key}` : key
            if (value && typeof value === "object" && Object.keys(value).length) {
                paths.push({value: newPath})
                paths = paths.concat(generatePaths(value, newPath))
            } else if (value && typeof value !== "object") {
                paths.push({value: newPath})
            }
        })
    } else if (Array.isArray(obj)) {
        obj.forEach((value, index) => {
            const newPath = `${currentPath}[${index}]`
            if (value && typeof value === "object" && Object.keys(value).length) {
                paths.push({value: newPath})
                paths = paths.concat(generatePaths(value, newPath))
            } else if (value && typeof value !== "object") {
                paths.push({value: newPath})
            }
        })
    }

    return paths
}

export const buildNodeTreeV3 = (node: AgentaNodeDTO): Record<string, any> => {
    const nodeMap: Record<string, any> = {
        [node.node.name]: {...node.data},
    }

    if (node.nodes) {
        Object.entries(node.nodes).forEach(([key, value]) => {
            if (Array.isArray(value)) {
                if (!nodeMap[node.node.name][key]) {
                    nodeMap[node.node.name][key] = []
                }

                value.forEach((childNode) => {
                    nodeMap[node.node.name][key].push(...Object.values(buildNodeTreeV3(childNode)))
                })
            } else {
                Object.assign(nodeMap[node.node.name], buildNodeTreeV3(value))
            }
        })
    }

    return nodeMap
}
