import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {traceDrawerAtom} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {
    buildNodeTree,
    observabilityTransformer,
    getNodeById,
} from "@/oss/lib/helpers/observability_helpers"
import useAnnotations from "@/oss/lib/hooks/useAnnotations"
import {attachAnnotationsToTraces} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {AgentaNodeDTO, TracesWithAnnotations} from "@/oss/services/observability/types"

export const useTraceDrawer = () => {
    const drawerState = useAtomValue(traceDrawerAtom)
    const traceSpans: any = (drawerState as any)?.result?.response?.tree
    const navigationIds: string[] | undefined = (drawerState as any)?.result?.navigationIds
    const activeTraceId: string | undefined = (drawerState as any)?.result?.activeTraceId

    const {data: annotations} = useAnnotations({
        queries: {
            annotation: {
                links:
                    traceSpans?.nodes?.map((node: any) => ({
                        trace_id: node?.trace_id,
                        span_id: node?.span_id,
                    })) || [],
            },
        },
        // Wait until we actually have spans to link annotations; don't gate on drawer visibility
        waitUntil: !traceSpans,
    })

    const traces = useMemo(() => {
        const payloadTraces = (drawerState as any)?.result?.traces as
            | TracesWithAnnotations[]
            | undefined

        const baseTraces =
            Array.isArray(payloadTraces) && payloadTraces.length
                ? payloadTraces
                : traceSpans
                  ? traceSpans.nodes
                        .flatMap((node: any) => buildNodeTree(node as AgentaNodeDTO))
                        .flatMap((item: any) => observabilityTransformer(item))
                  : []

        // Only attach fetched annotations when they exist; otherwise preserve
        // any annotation data already present on the traces (e.g. traces from
        // the Observability page come pre-annotated).
        return annotations === undefined
            ? (baseTraces as TracesWithAnnotations[])
            : (attachAnnotationsToTraces(baseTraces, annotations) as TracesWithAnnotations[])
    }, [drawerState, traceSpans, annotations])

    const getTraceById = (id?: string): TracesWithAnnotations | undefined => {
        if (!id) return undefined
        // Search recursively within the full tree so child node selections work
        const found = getNodeById(traces as any, id)
        return (found as TracesWithAnnotations) || undefined
    }

    return {open: drawerState.open, traces, getTraceById, navigationIds, activeTraceId}
}

export default useTraceDrawer
