import type {OpenFromTraceResult} from "@agenta/playground"
import {playgroundController} from "@agenta/playground"
import {atom} from "jotai"

import type {TraceSpanNode} from "@/oss/services/tracing/types"

import {closeTraceDrawerAtom} from "./traceDrawerStore"

export type {OpenFromTraceResult}

/**
 * Thin wrapper that delegates to playgroundController.actions.openFromTrace
 * and closes the trace drawer.
 *
 * Navigation to the playground page is handled by the calling component.
 */
export const openTraceInPlaygroundAtom = atom(
    null,
    (_get, set, activeSpan: TraceSpanNode): OpenFromTraceResult => {
        const result = set(playgroundController.actions.openFromTrace, activeSpan)
        set(closeTraceDrawerAtom)
        return result
    },
)
