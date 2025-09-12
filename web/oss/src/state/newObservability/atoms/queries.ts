import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {selectAtom, atomFamily} from "jotai/utils"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import {ensureProjectId} from "@/oss/lib/api/assets/fetchClient"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {formatLatency, formatCurrency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {
    buildNodeTree,
    observabilityTransformer,
    getNodeById,
} from "@/oss/lib/helpers/observability_helpers"
import {
    attachAnnotationsToTraces,
    groupAnnotationsByReferenceId,
} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import type {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {queryAllAnnotations} from "@/oss/services/annotations/api"
import {fetchAllTraces} from "@/oss/services/observability/core"
import type {
    _AgentaRootsResponse,
    TracesWithAnnotations,
    AgentaRootsDTO,
    AgentaTreeDTO,
    AgentaNodeDTO,
} from "@/oss/services/observability/types"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {getOrgValues} from "@/oss/state/org"

import {
    paginationAtom,
    sortAtom,
    filtersAtom,
    traceTabsAtom,
    selectedTraceIdAtom,
    selectedNodeAtom,
} from "./controls"

// Traces query ----------------------------------------------------------------
export const tracesQueryAtom = atomWithQuery((get) => {
    const appId = get(selectedAppIdAtom)
    const pagination = get(paginationAtom)
    const sort = get(sortAtom)
    const filters = get(filtersAtom)
    const traceTabs = get(traceTabsAtom)
    const projectId = ensureProjectId()
    const params: Record<string, any> = {
        size: pagination.size,
        page: pagination.page,
        focus: traceTabs === "chat" ? "node" : traceTabs,
    }

    if (filters.length > 0) {
        const sanitized = filters.map(({isPermanent, ...rest}) => rest)
        params.filtering = JSON.stringify({conditions: sanitized})
    }

    if (sort) {
        if (sort.type === "standard") {
            params.oldest = sort.sorted
        } else if (
            sort.type === "custom" &&
            (sort.customRange?.startTime || sort.customRange?.endTime)
        ) {
            const {startTime, endTime} = sort.customRange
            if (startTime) params.oldest = startTime
            if (endTime) params.newest = endTime
        }
    }

    return {
        queryKey: ["traces", appId, params],
        queryFn: async () => {
            const data = await fetchAllTraces(params, appId as string)

            const transformed: _AgentaRootsResponse[] = []
            if (data?.roots) {
                transformed.push(
                    ...data.roots.flatMap((item: AgentaRootsDTO) =>
                        observabilityTransformer(item.trees[0]),
                    ),
                )
            }

            if (data?.trees) {
                transformed.push(
                    ...data.trees.flatMap((item: AgentaTreeDTO) => observabilityTransformer(item)),
                )
            }

            if (data?.nodes) {
                transformed.push(
                    ...data.nodes
                        .flatMap((node: AgentaNodeDTO) => buildNodeTree(node))
                        .flatMap((item: AgentaTreeDTO) => observabilityTransformer(item)),
                )
            }

            return {
                traces: transformed,
                traceCount: data?.count || 0,
            }
        },
        enabled: !!projectId,
        refetchOnWindowFocus: false,
    }
})

// Base traces atom -------------------------------------------------------------
export const tracesAtom = selectAtom(
    tracesQueryAtom,
    (query) => query.data?.traces ?? [],
    deepEqual,
)

export const traceCountAtom = selectAtom(tracesQueryAtom, (query) => query.data?.traceCount ?? 0)

// Annotation links -------------------------------------------------------------
export const annotationLinksAtom = eagerAtom((get) =>
    (get(tracesAtom) as any[])
        .map((t) => t.invocationIds || {})
        .filter((l) => Object.keys(l).length > 0),
)

// Annotations query ------------------------------------------------------------
export const annotationsQueryAtom = atomWithQuery((get) => {
    const links = get(annotationLinksAtom)
    const {selectedOrg} = getOrgValues()
    const members = selectedOrg?.default_workspace?.members || []

    return {
        queryKey: ["annotations", links],
        queryFn: async () => {
            if (Array.isArray(links) && !links.length) return [] as AnnotationDto[]
            const res = await queryAllAnnotations({annotation: {links}})
            return (
                res.annotations?.map((a) => transformApiData<AnnotationDto>({data: a, members})) ||
                []
            )
        },
        enabled: Array.isArray(links) && links.length > 0,
        refetchOnWindowFocus: false,
    }
})

export const annotationsAtom = selectAtom(annotationsQueryAtom, (q) => q.data ?? [], deepEqual)

// Combined traces with annotations --------------------------------------------
export const tracesWithAnnotationsAtom = eagerAtom<TracesWithAnnotations[]>((get) =>
    attachAnnotationsToTraces(get(tracesAtom) as any[], get(annotationsAtom) as AnnotationDto[]),
)

// Loading state ----------------------------------------------------------------
export const observabilityLoadingAtom = eagerAtom((get) => {
    const tracesLoading = get(tracesQueryAtom).isLoading
    const annotationsLoading = get(annotationsQueryAtom).isLoading
    return tracesLoading || annotationsLoading
})

// Derived selection helpers ----------------------------------------------------
export const activeTraceIndexAtom = eagerAtom((get) => {
    const traces = get(tracesWithAnnotationsAtom)
    const selectedId = get(selectedTraceIdAtom)
    const tab = get(traceTabsAtom)
    return traces.findIndex((item) =>
        tab === "node" ? item.node.id === selectedId : item.root.id === selectedId,
    )
})

export const activeTraceAtom = eagerAtom((get) => {
    const traces = get(tracesWithAnnotationsAtom)
    const idx = get(activeTraceIndexAtom)
    return idx >= 0 ? traces[idx] : null
})

export const selectedItemAtom = eagerAtom((get) => {
    const traces = get(tracesWithAnnotationsAtom)
    const selected = get(selectedNodeAtom)
    if (!traces.length || !selected) return null
    return getNodeById(traces, selected) || null
})

// Annotation helpers ----------------------------------------------------------
export const annotationEvaluatorSlugsAtom = selectAtom(
    annotationsAtom,
    (anns: AnnotationDto[]) =>
        Array.from(
            new Set(anns.map((a) => a.references?.evaluator?.slug).filter(Boolean)),
        ) as string[],
    deepEqual,
)

export const traceAnnotationInfoAtomFamily = atomFamily((key: string) =>
    atom((get) => {
        const [traceId = "", spanId = ""] = key.split(":")
        const anns = get(annotationsAtom) as AnnotationDto[]
        const matching = anns.filter(
            (annotation) =>
                annotation.links?.invocation?.trace_id === traceId &&
                annotation.links?.invocation?.span_id === spanId,
        )
        return {
            annotations: matching,
            aggregatedEvaluatorMetrics: groupAnnotationsByReferenceId(matching),
        }
    }, deepEqual),
)

// Formatting helpers ----------------------------------------------------------
export const nodeDisplayNameAtomFamily = atomFamily((name: string) =>
    atom(() => {
        const truncated = name.length >= 15
        return {
            text: truncated ? `${name.slice(0, 15)}...` : name,
            full: name,
            truncated,
        }
    }),
)

export const formattedTimestampAtomFamily = atomFamily((ts?: string) =>
    atom(() => formatDay({date: ts, outputFormat: "HH:mm:ss DD MMM YYYY"})),
)

export const formattedDurationAtomFamily = atomFamily((ms?: number) =>
    atom(() => formatLatency(ms ? ms / 1000 : null)),
)

export const formattedCostAtomFamily = atomFamily((cost?: number) =>
    atom(() => formatCurrency(cost)),
)

export const formattedUsageAtomFamily = atomFamily((tokens?: number) =>
    atom(() => formatTokenUsage(tokens)),
)
