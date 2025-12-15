import {TraceSpanNode} from "@/oss/services/tracing/types"
import {Dispatch, SetStateAction} from "react"

export type TraceTypeHeaderProps = {
    activeTrace: TraceSpanNode | undefined
    error: any
    traces?: TraceSpanNode[]
    setSelectedTraceId: (val: string) => void
    setIsAnnotationsSectionOpen?: Dispatch<SetStateAction<boolean>>
    isAnnotationsSectionOpen?: boolean
}
