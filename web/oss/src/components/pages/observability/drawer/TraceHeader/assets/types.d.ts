import {Dispatch, SetStateAction} from "react"

import {_AgentaRootsResponse, TracesWithAnnotations} from "@/oss/services/observability/types"
import {TraceSpanNode} from "@/oss/services/tracing/types"

export interface TraceHeaderProps {
    // Original props (ObservabilityDashboard)
    activeTrace?: TracesWithAnnotations
    traces?: TraceSpanNode[]
    // Lean alternative: pass just the active trace id (TraceDrawer)
    activeTraceId?: string
    // Optional explicit navigation id list (preferred when provided)
    navigationIds?: string[]
    setSelectedTraceId: (val: string) => void
    setSelectedNode?: (val: string) => void
    activeTraceIndex?: number
    setIsAnnotationsSectionOpen?: Dispatch<SetStateAction<boolean>>
    isAnnotationsSectionOpen?: boolean
    setSelected?: Dispatch<SetStateAction<string>>
}
