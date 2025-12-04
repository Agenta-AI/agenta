import {Dispatch, SetStateAction} from "react"

import {_AgentaRootsResponse, TracesWithAnnotations} from "@/oss/services/observability/types"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {Filter} from "@/oss/lib/Types"
import {SortResult} from "@/oss/components/Filters/Sort"
import {QueryValue} from "@/oss/state/appState/types"
import {TraceTabTypes} from "@/oss/state/newObservability/atoms/controls"

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
    setTraceParam: (
        value: QueryValue | ((prev: QueryValue) => QueryValue),
        options?: {shallow?: boolean; preserveHash?: boolean},
    ) => void
    setSpanParam: (
        value: QueryValue | ((prev: QueryValue) => QueryValue),
        options?: {shallow?: boolean; preserveHash?: boolean},
    ) => void
    setTraceDrawerTrace: (payload: {traceId: string; activeSpanId?: string | null}) => void
    activeTraceIndex?: number
    setSelected?: Dispatch<SetStateAction<string>>
}

export type NavSource = "table" | "remote"

export interface NavState {
    candidate: TraceSpanNode | null
    loading: boolean
    source: NavSource | null
}