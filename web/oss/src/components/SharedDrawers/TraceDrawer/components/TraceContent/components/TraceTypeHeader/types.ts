import {Dispatch, SetStateAction} from "react"

import {TraceSpanNode} from "@/oss/services/tracing/types"

export interface TraceTypeHeaderProps {
    activeTrace: TraceSpanNode | undefined
    error: any
    traces?: TraceSpanNode[]
    setSelectedTraceId: (val: string) => void
    setIsAnnotationsSectionOpen?: Dispatch<SetStateAction<boolean>>
    isAnnotationsSectionOpen?: boolean
}
