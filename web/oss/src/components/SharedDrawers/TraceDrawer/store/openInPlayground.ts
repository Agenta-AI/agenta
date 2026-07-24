import type {TraceSpanNode as EntityTraceSpanNode} from "@agenta/entities/trace"
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
    async (_get, set, activeSpan: TraceSpanNode): Promise<OpenFromTraceResult> => {
        // OSS TraceSpanNode is the same backend span shape as the entities-package type
        // the controller expects; align at the boundary, no data is converted.
        return set(
            playgroundController.actions.openFromTrace,
            activeSpan as unknown as EntityTraceSpanNode,
        )
    },
)
