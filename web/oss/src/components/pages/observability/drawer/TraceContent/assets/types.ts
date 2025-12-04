import {TraceSpanNode} from "@/oss/services/tracing/types"
import {Dispatch, SetStateAction} from "react"

export interface TraceContentProps {
    activeTrace?: TraceSpanNode
    traceResponse?: any
    error?: any
    isLoading?: boolean
    setSelectedTraceId: (val: string) => void
    setIsAnnotationsSectionOpen?: Dispatch<SetStateAction<boolean>>
    isAnnotationsSectionOpen?: boolean
    traces?: TraceSpanNode[]
    activeId: string
}
