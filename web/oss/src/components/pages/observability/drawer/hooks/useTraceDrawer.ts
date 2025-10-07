import {useMemo} from "react"

import {useAtomValue} from "jotai"
import {
    isDrawerOpenAtom,
    traceDrawerActiveSpanIdAtom,
    traceDrawerTraceIdAtom,
    traceDrawerQueryAtom,
} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {observabilityTransformer, getNodeById} from "@/oss/lib/helpers/observability_helpers"
import useAnnotations from "@/oss/lib/hooks/useAnnotations"
import {attachAnnotationsToTraces} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {AgentaTreeDTO, TracesWithAnnotations} from "@/oss/services/observability/types"
import {
    transformTracesResponseToTree,
    transformTracingResponse,
} from "@/oss/services/tracing/lib/helpers"
import {TraceSpanNode, TracesResponse} from "@/oss/services/tracing/types"

export const useTraceDrawer = () => {
    const open = useAtomValue(isDrawerOpenAtom)
    const traceId = useAtomValue(traceDrawerTraceIdAtom)
    const activeSpanId = useAtomValue(traceDrawerActiveSpanIdAtom)

    const {data: traceResponse, error, isLoading} = useAtomValue(traceDrawerQueryAtom)

    const tree = traceResponse?.response?.tree as AgentaTreeDTO | undefined

    const normalizeTracesResponse = (raw: any): TracesResponse | null => {
        if (!raw) return null
        if (raw.traces) return raw as TracesResponse
        if (raw.trace) {
            return {traces: {current: raw.trace}} as unknown as TracesResponse
        }
        if (raw.response?.trace) {
            return {traces: {current: raw.response.trace}} as unknown as TracesResponse
        }
        return null
    }

    const fallbackNodes = useMemo(() => {
        const normalized = normalizeTracesResponse(traceResponse)
        if (!normalized) return [] as TraceSpanNode[]
        return transformTracingResponse(transformTracesResponseToTree(normalized))
    }, [traceResponse])

    const baseTraces = useMemo(() => {
        if (tree) {
            return observabilityTransformer(tree) as TracesWithAnnotations[]
        }
        return fallbackNodes as unknown as TracesWithAnnotations[]
    }, [tree, fallbackNodes])

    const flatten = (nodes: TracesWithAnnotations[]): TracesWithAnnotations[] => {
        const stack = [...nodes]
        const result: TracesWithAnnotations[] = []

        while (stack.length) {
            const node = stack.shift()
            if (!node) continue
            result.push(node)
            if (Array.isArray(node.children)) {
                stack.unshift(...(node.children as unknown as TracesWithAnnotations[]))
            }
        }

        return result
    }

    const flatBaseTraces = useMemo(() => flatten(baseTraces), [baseTraces])
    const annotationLinks = useMemo(
        () =>
            flatBaseTraces.map((node) => ({
                trace_id: node?.invocationIds?.trace_id || node?.trace_id,
                span_id: node?.invocationIds?.span_id || node?.span_id,
            })),
        [flatBaseTraces],
    )

    const {data: annotations} = useAnnotations({
        queries: {
            annotation: {
                links: annotationLinks,
            },
        },
        waitUntil: annotationLinks.length === 0,
    })

    const traces = useMemo(() => {
        if (!baseTraces.length) return [] as TracesWithAnnotations[]
        return annotations === undefined
            ? baseTraces
            : (attachAnnotationsToTraces(baseTraces, annotations) as TracesWithAnnotations[])
    }, [baseTraces, annotations])

    const flatAnnotatedTraces = useMemo(() => flatten(traces), [traces])

    const resolvedActiveSpanId = useMemo(() => {
        if (!flatAnnotatedTraces.length) return null
        if (activeSpanId && flatAnnotatedTraces.some((t) => t.span_id === activeSpanId)) {
            return activeSpanId
        }
        return flatAnnotatedTraces[0]?.span_id || null
    }, [activeSpanId, flatAnnotatedTraces])

    const getTraceById = (id?: string): TracesWithAnnotations | undefined => {
        if (!id) return undefined
        const found = getNodeById(traces as any, id)
        return (found as TracesWithAnnotations) || undefined
    }

    const loadingState = Boolean(traceId) && (Boolean(isLoading) || (!traceResponse && !error))

    return {
        open,
        traceId,
        activeSpanId: resolvedActiveSpanId,
        traces,
        traceResponse,
        error,
        isLoading: loadingState,
        getTraceById,
    }
}

export default useTraceDrawer
