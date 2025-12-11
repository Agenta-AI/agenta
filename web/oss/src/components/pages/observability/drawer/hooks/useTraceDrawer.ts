import {useAtomValue} from "jotai"

import {
    senitizedTracesAtom,
    traceDrawerAnnotationsQueryAtom,
    traceDrawerFlatAnnotatedTracesAtom,
    traceDrawerGetTraceByIdAtom,
    traceDrawerQueryAtom,
    traceDrawerResolvedActiveSpanIdAtom,
    traceDrawerTraceIdAtom,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"

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
