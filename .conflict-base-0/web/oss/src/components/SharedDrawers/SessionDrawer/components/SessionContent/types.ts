import {TraceSpanNode} from "@/oss/services/tracing/types"

export interface SessionContentProps {
    activeTrace?: TraceSpanNode
    traceResponse?: any
    error?: any
    isLoading?: boolean
    setSelectedTraceId: (val: string) => void
    traces?: TraceSpanNode[]
    activeId: string
}
