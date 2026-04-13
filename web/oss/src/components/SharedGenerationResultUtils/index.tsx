import {memo, useCallback} from "react"

import {
    SharedGenerationResultUtils as EntitySharedGenerationResultUtils,
    type SharedGenerationResultUtilsProps as EntitySharedGenerationResultUtilsProps,
} from "@agenta/entity-ui"
import {getDefaultStore} from "jotai"

import {
    openTraceDrawerAtom,
    setTraceDrawerActiveSpanAtom,
} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"
import {requestNavigationAtom} from "@/oss/state/appState"

const globalStore = getDefaultStore()

export interface SharedGenerationResultUtilsProps extends Omit<
    EntitySharedGenerationResultUtilsProps,
    "onViewTrace"
> {
    /** @deprecated Use traceId only; kept for backwards compatibility while migrating callsites */
    tree?: {
        trace_id?: string
    } | null
}

const SharedGenerationResultUtils = ({
    traceId,
    tree,
    ...rest
}: SharedGenerationResultUtilsProps) => {
    const effectiveTraceId = traceId ?? tree?.trace_id ?? null

    const onViewTrace = useCallback(
        ({traceId: nextTraceId, spanId}: {traceId: string; spanId?: string | null}) => {
            if (!nextTraceId) return
            globalStore.set(openTraceDrawerAtom, {
                traceId: nextTraceId,
                activeSpanId: spanId ?? null,
            })
            globalStore.set(setTraceDrawerActiveSpanAtom, spanId ?? null)
            // Batch trace and span into a single navigation command to avoid
            // a race where the second patch overwrites the first, and preserve
            // the URL hash so the playground snapshot is not lost.
            globalStore.set(requestNavigationAtom, {
                type: "patch-query",
                patch: {
                    trace: nextTraceId,
                    span: spanId ?? undefined,
                },
                shallow: true,
                preserveHash: true,
            })
        },
        [],
    )

    return (
        <EntitySharedGenerationResultUtils
            traceId={effectiveTraceId}
            onViewTrace={onViewTrace}
            {...rest}
        />
    )
}

export default memo(SharedGenerationResultUtils)
