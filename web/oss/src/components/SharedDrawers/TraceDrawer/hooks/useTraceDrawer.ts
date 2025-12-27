import {useEffect} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {
    hydrateSpanCacheEffectAtom,
    senitizedTracesAtom,
    traceDrawerAnnotationsQueryAtom,
    traceDrawerFlatAnnotatedTracesAtom,
    traceDrawerGetTraceByIdAtom,
    traceDrawerQueryAtom,
    traceDrawerResolvedActiveSpanIdAtom,
    traceDrawerTraceIdAtom,
} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"

export const useTraceDrawer = () => {
    const traceId = useAtomValue(traceDrawerTraceIdAtom)
    const traceQuery = useAtomValue(traceDrawerQueryAtom)
    const annotationsQuery = useAtomValue(traceDrawerAnnotationsQueryAtom)

    const traces = useAtomValue(senitizedTracesAtom)
    const _flatAnnotatedTraces = useAtomValue(traceDrawerFlatAnnotatedTracesAtom)
    const resolvedActiveSpanId = useAtomValue(traceDrawerResolvedActiveSpanIdAtom)
    const getTraceById = useAtomValue(traceDrawerGetTraceByIdAtom)

    // Hydrate entity cache when traces are loaded
    const hydrateSpanCache = useSetAtom(hydrateSpanCacheEffectAtom)
    useEffect(() => {
        if (traces.length > 0) {
            hydrateSpanCache()
        }
    }, [traces, hydrateSpanCache])

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
