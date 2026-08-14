import {Dispatch, SetStateAction} from "react"

import {TraceSpanNode} from "@agenta/observability"

export interface TraceTypeHeaderProps {
    activeTrace: TraceSpanNode | undefined
    error: unknown
    traces?: TraceSpanNode[]
    setSelectedTraceId: (val: string) => void
    setIsAnnotationsSectionOpen?: Dispatch<SetStateAction<boolean>>
    isAnnotationsSectionOpen?: boolean
}
