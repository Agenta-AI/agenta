import {Dispatch, SetStateAction} from "react"

import {SortResult, TraceTabTypes} from "@agenta/observability"
import {_AgentaRootsResponse, TracesWithAnnotations} from "@agenta/observability/dto"

import {Filter} from "@/oss/lib/Types"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {QueryValue} from "@/oss/state/appState/types"

export interface SessionHeaderProps {
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
