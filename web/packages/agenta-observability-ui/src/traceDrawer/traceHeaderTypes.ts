import {Dispatch, SetStateAction} from "react"

import type {Filter, SortResult, TraceSpanNode, TraceTabTypes} from "@agenta/observability"
import type {TracesWithAnnotations} from "@agenta/observability/dto"

export interface TraceHeaderProps {
    // Original props (ObservabilityDashboard)
    activeTrace?: TracesWithAnnotations
    traces?: TraceSpanNode[]
    // Lean alternative: pass just the active trace id (TraceDrawer)
    activeTraceId?: string
    traceId?: string | null
    traceTabs: TraceTabTypes
    filters: Filter[]
    sort: SortResult
    limit: number
    setSelectedTraceId: (val: string) => void
    setSelectedNode?: (val: string) => void
    // The query-param seam writes shallow and takes a plain value; antd-era callers passed an
    // updater plus options, neither of which the seam needs.
    setTraceParam: (value: string | null | undefined) => void
    setSpanParam: (value: string | null | undefined) => void
    setTraceDrawerTrace: (payload: {
        traceId?: string
        activeSpanId?: string | null
        source?: "external" | "linked" | "back"
    }) => void
    activeTraceIndex?: number
    setSelected?: Dispatch<SetStateAction<string>>
}

export type NavSource = "table" | "remote"

export interface NavState {
    candidate: TraceSpanNode | null
    loading: boolean
    source: NavSource | null
}
