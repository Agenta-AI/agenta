import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchPreviewTrace} from "@/oss/services/tracing/api"

export interface TraceDrawerState {
    open: boolean
    traceId: string | null
    activeSpanId: string | null
}

export type TraceDrawerTabKey = "overview" | "raw_data" | "annotations"

export const TRACE_DRAWER_VIEWPORT_ID = "trace-drawer-viewport"

export const initialTraceDrawerState: TraceDrawerState = {
    open: false,
    traceId: null,
    activeSpanId: null,
}

export const traceDrawerAtom = atomWithImmer<TraceDrawerState>(initialTraceDrawerState)

export const isDrawerOpenAtom = atom((get) => get(traceDrawerAtom).open)
export const traceDrawerTraceIdAtom = atom((get) => get(traceDrawerAtom).traceId)
export const traceDrawerActiveSpanIdAtom = atom((get) => get(traceDrawerAtom).activeSpanId)
export const traceDrawerActiveTabAtom = atom<TraceDrawerTabKey>("overview")

export const resetTraceDrawerAtom = atom(null, (_get, set) => {
    set(traceDrawerAtom, initialTraceDrawerState)
    set(traceDrawerActiveTabAtom, "overview")
})

export const closeTraceDrawerAtom = atom(null, (_get, set) => {
    set(traceDrawerAtom, (draft) => {
        draft.open = false
    })
})

export const openTraceDrawerAtom = atom(
    null,
    (_get, set, payload: {traceId: string; activeSpanId?: string | null}) => {
        set(traceDrawerAtom, (draft) => {
            draft.open = true
            draft.traceId = payload.traceId
            draft.activeSpanId = payload.activeSpanId ?? null
        })
    },
)

export const setTraceDrawerActiveSpanAtom = atom(null, (_get, set, activeSpanId: string | null) => {
    set(traceDrawerAtom, (draft) => {
        draft.activeSpanId = activeSpanId
    })
})

export const setTraceDrawerTraceAtom = atom(
    null,
    (_get, set, payload: {traceId: string; activeSpanId?: string | null}) => {
        set(traceDrawerAtom, (draft) => {
            draft.traceId = payload.traceId
            if (payload.activeSpanId !== undefined) {
                draft.activeSpanId = payload.activeSpanId
            }
        })
    },
)

export const traceDrawerQueryAtom = atomWithQuery((get) => {
    const traceId = get(traceDrawerTraceIdAtom)

    return {
        queryKey: ["trace-drawer", traceId ?? "none"],
        enabled: Boolean(traceId),
        refetchOnWindowFocus: false,
        queryFn: async () => {
            if (!traceId) return null
            return fetchPreviewTrace(traceId)
        },
    }
})
