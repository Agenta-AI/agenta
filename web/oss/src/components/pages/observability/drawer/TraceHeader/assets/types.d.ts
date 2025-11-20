import {Dispatch, SetStateAction} from "react"

import {_AgentaRootsResponse, TracesWithAnnotations} from "@/oss/services/observability/types"

export interface TraceHeaderProps {
    activeTrace: TracesWithAnnotations
    traces: _AgentaRootsResponse[]
    setSelectedTraceId: (val: string) => void
    activeTraceIndex?: number
    setIsAnnotationsSectionOpen?: Dispatch<SetStateAction<boolean>>
    isAnnotationsSectionOpen?: boolean
    setSelected?: Dispatch<SetStateAction<string>>
}
