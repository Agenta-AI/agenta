import {TraceSpanNode, TracesResponse, SpansResponse} from "../types"

export const isTracesResponse = (data: any): data is TracesResponse => {
    return typeof data === "object" && "traces" in data
}

export const isSpansResponse = (data: any): data is SpansResponse => {
    return typeof data === "object" && "spans" in data
}

export const transformTracesResponseToTree = (data: TracesResponse): TraceSpanNode[] => {
    const buildTree = (spans: Record<string, any> | any[]): TraceSpanNode[] => {
        if (!spans) {
            return []
        }

        return Object.values(spans).flatMap((span: any) => {
            if (Array.isArray(span)) {
                return buildTree(span)
            }

            const node: TraceSpanNode = {
                ...span,
            }

            if (span?.spans && Object.keys(span.spans).length > 0) {
                node.children = buildTree(span.spans)
            }

            return node
        })
    }

    return Object.values(data.traces).flatMap((trace: any) => buildTree(trace.spans))
}

export const transformTracingResponse = (data: TraceSpanNode[]): TraceSpanNode[] => {
    const enhance = (span: TraceSpanNode): TraceSpanNode => ({
        ...span,
        key: span.span_id,
        invocationIds: {
            trace_id: span.trace_id,
            span_id: span.span_id,
        },
        children: span.children?.map(enhance),
    })

    return data.map(enhance)
}
