import {useEffect, useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {
    senitizedTracesAtom,
    setTraceDrawerSpanLinksAtom,
    traceDrawerAnnotationsQueryAtom,
    traceDrawerFlatAnnotatedTracesAtom,
    traceDrawerGetTraceByIdAtom,
    traceDrawerQueryAtom,
    traceDrawerResolvedActiveSpanIdAtom,
    traceDrawerTraceIdAtom,
    TraceDrawerSpanLink,
    linksAndReferencesAtom,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {TracesWithAnnotations} from "@/oss/services/observability/types"
import {SpanLink} from "@/oss/services/tracing/types"

export const useTraceDrawer = () => {
    const traceId = useAtomValue(traceDrawerTraceIdAtom)
    const traceQuery = useAtomValue(traceDrawerQueryAtom)
    const annotationsQuery = useAtomValue(traceDrawerAnnotationsQueryAtom)

    const traces = useAtomValue(senitizedTracesAtom)
    const flatAnnotatedTraces = useAtomValue(traceDrawerFlatAnnotatedTracesAtom)
    const resolvedActiveSpanId = useAtomValue(traceDrawerResolvedActiveSpanIdAtom)
    const getTraceById = useAtomValue(traceDrawerGetTraceByIdAtom)

    const loadingState =
        Boolean(traceId) &&
        (Boolean(traceQuery.isLoading) ||
            (!traceQuery.data && !traceQuery.error) ||
            Boolean(annotationsQuery.isLoading))

    return {
        traceId,
        activeSpanId: resolvedActiveSpanId,
        traces,
        traceResponse: traceQuery.data,
        error: traceQuery.error,
        isLoading: loadingState,
        getTraceById,
    }
}

export default useTraceDrawer
