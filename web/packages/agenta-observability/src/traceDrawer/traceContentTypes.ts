import type {TraceSpanNode} from "../core/traceSpan"

export interface TraceContentProps {
    activeTrace?: TraceSpanNode
    traceResponse?: unknown
    error?: unknown
    isLoading?: boolean
    setSelectedTraceId: (val: string) => void
    traces?: TraceSpanNode[]
    activeId: string
}
