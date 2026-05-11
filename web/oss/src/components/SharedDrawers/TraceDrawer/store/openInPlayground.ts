import type {OpenFromTraceResult} from "@agenta/playground"
import {playgroundController} from "@agenta/playground"
import {atom} from "jotai"

import type {TraceSpanNode} from "@/oss/services/tracing/types"

export type {OpenFromTraceResult}

/**
 * Thin wrapper that delegates to playgroundController.actions.openFromTrace.
 *
 * The caller decides what happens next:
 *   - If the result has an `appId`, the caller navigates to the app-scoped
 *     playground page (and is responsible for closing the trace drawer).
 *   - Otherwise, the caller opens the playground in the workflow revision
 *     drawer overlaid on top of the trace drawer (which stays open behind).
 */
export const openTraceInPlaygroundAtom = atom(
    null,
    (_get, set, activeSpan: TraceSpanNode): OpenFromTraceResult => {
        return set(playgroundController.actions.openFromTrace, activeSpan)
    },
)
