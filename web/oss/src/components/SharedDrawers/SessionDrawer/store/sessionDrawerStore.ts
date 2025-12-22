import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
// import {atomWithImmer} from "jotai-immer" // Not using immer for now to keep it simple or use it if complexity grows
import {atomWithImmer} from "jotai-immer"
import {atomWithQuery} from "jotai-tanstack-query"

import {attachAnnotationsToTraces} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {getNodeById, observabilityTransformer} from "@/oss/lib/traces/observability_helpers"
import {queryAllAnnotations} from "@/oss/services/annotations/api"
import {AgentaTreeDTO, TracesWithAnnotations} from "@/oss/services/observability/types"
import {fetchAllPreviewTraces, fetchPreviewTrace} from "@/oss/services/tracing/api"
import {
    isSpansResponse,
    isTracesResponse,
    transformTracesResponseToTree,
    transformTracingResponse,
} from "@/oss/services/tracing/lib/helpers"
import {SpanLink, TraceSpanNode, TracesResponse} from "@/oss/services/tracing/types"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"
import {getOrgValues} from "@/oss/state/org"
import {projectIdAtom} from "@/oss/state/project"
import {sessionExistsAtom} from "@/oss/state/session"

// ---------- Types ----------
export interface SessionDrawerState {
    open: boolean
    sessionId: string | null
    activeSpanId: string | null
}

export type SessionTraceNode = TraceSpanNode & {
    annotations?: AnnotationDto[]
    aggregatedEvaluatorMetrics?: Record<string, any>
}

export interface AnnotationLinkTarget {
    trace_id: string
    span_id: string
    key?: string
    type?: string
    source?: string
    attributes?: Record<string, any>
    trace?: TracesWithAnnotations[]
}

const normalizeTracesResponse = (raw: any): TracesResponse | null => {
    if (!raw) return null
    if ((raw as TracesResponse).traces) return raw as TracesResponse
    if ((raw as any).trace) {
        return {traces: {current: (raw as any).trace}} as unknown as TracesResponse
    }
    if ((raw as any).response?.trace) {
        return {traces: {current: (raw as any).response.trace}} as unknown as TracesResponse
    }
    return null
}

export const initialSessionDrawerState: SessionDrawerState = {
    open: false,
    sessionId: null,
    activeSpanId: null,
}

export const sessionDrawerAtom = atomWithImmer<SessionDrawerState>(initialSessionDrawerState)

export const isDrawerOpenAtom = atom((get) => get(sessionDrawerAtom).open)
export const sessionDrawerSessionIdAtom = atom((get) => get(sessionDrawerAtom).sessionId)
export const sessionDrawerActiveSpanIdAtom = atom((get) => get(sessionDrawerAtom).activeSpanId)

export const openSessionDrawerAtom = atom(
    null,
    (_get, set, payload: {sessionId: string; activeSpanId?: string | null}) => {
        set(sessionDrawerAtom, (draft) => {
            draft.open = true
            draft.sessionId = payload.sessionId
            draft.activeSpanId = payload.activeSpanId ?? null
        })
    },
)

export const closeSessionDrawerAtom = atom(null, (_get, set) => {
    set(sessionDrawerAtom, (draft) => {
        draft.open = false
    })
})

export const setSessionDrawerActiveSpanAtom = atom(
    null,
    (_get, set, activeSpanId: string | null) => {
        set(sessionDrawerAtom, (draft) => {
            draft.activeSpanId = activeSpanId
        })
    },
)

// ---------- Data fetching ----------

export const sessionTracesQueryAtom = atomWithQuery((get) => {
    const appId = get(selectedAppIdAtom)
    const projectId = get(projectIdAtom)
    const sessionId = get(sessionDrawerSessionIdAtom)
    const sessionExists = get(sessionExistsAtom)

    // Default params for session traces
    const params: any = {
        filter: {
            conditions: [
                {
                    field: "attributes",
                    key: "ag.session.id",
                    operator: "is",
                    value: sessionId,
                },
            ],
        },
        focus: "trace",
    }

    return {
        queryKey: ["session-traces", projectId, appId, sessionId],
        queryFn: async () => {
            if (!sessionId) return {traces: [], count: 0}
            return fetchAllPreviewTraces(params, appId as string)
        },
        enabled: sessionExists && Boolean(appId || projectId) && Boolean(sessionId),
        refetchOnWindowFocus: false,
    }
})

export const sessionTracesAtom = atom<TraceSpanNode[]>((get) => {
    const {data} = get(sessionTracesQueryAtom)
    if (!data) return []

    const transformed: TraceSpanNode[] = []
    if (isTracesResponse(data)) {
        transformed.push(...transformTracingResponse(transformTracesResponseToTree(data)))
    } else if (isSpansResponse(data)) {
        transformed.push(...transformTracingResponse(data.spans))
    }

    const filtred = transformed.filter((node) => node.trace_type !== "annotation")
    return filtred
})

export const flattenedSessionTracesAtom = atom<TraceSpanNode[]>((get) => {
    const traces = get(sessionTracesAtom)
    const flatten = (nodes: TraceSpanNode[]): TraceSpanNode[] => {
        let result: TraceSpanNode[] = []
        nodes.forEach((node) => {
            result.push(node)
            if (node.children) {
                result = [...result, ...flatten(node.children as TraceSpanNode[])]
            }
        })
        return result
    }
    return flatten(traces)
})

export const isSessionDrawerLoadingAtom = atom((get) => {
    const query = get(sessionTracesQueryAtom)
    return query.isLoading
})

// ---------- Annotations ----------

export const sessionDrawerAnnotationLinksAtom = atom<{trace_id: string; span_id: string}[]>((get) =>
    get(flattenedSessionTracesAtom).map((node) => ({
        trace_id: node.trace_id,
        span_id: node.span_id,
    })),
)

export const sessionDrawerAnnotationsQueryAtom = atomWithQuery((get) => {
    const links = get(sessionDrawerAnnotationLinksAtom)
    const {selectedOrg} = getOrgValues()
    const members = selectedOrg?.default_workspace?.members || []

    return {
        queryKey: ["session-drawer-annotations", links],
        enabled: Array.isArray(links) && links.length > 0,
        refetchOnWindowFocus: false,
        queryFn: async () => {
            if (!Array.isArray(links) || !links.length) return [] as AnnotationDto[]
            const res = await queryAllAnnotations({annotation: {links}})
            return (
                res.annotations?.map((a) => transformApiData<AnnotationDto>({data: a, members})) ||
                []
            )
        },
    }
})

export const sessionDrawerAnnotationsAtom = atom((get) => {
    const query = get(sessionDrawerAnnotationsQueryAtom)
    return (query.data as AnnotationDto[]) ?? []
})

export const sessionAnnotatedTracesAtom = atom<SessionTraceNode[]>((get) => {
    const base = get(sessionTracesAtom)
    const annotations = get(sessionDrawerAnnotationsAtom)
    if (!base.length) return []
    if (!annotations || !annotations.length) return base as SessionTraceNode[]
    return attachAnnotationsToTraces(base, annotations) as SessionTraceNode[]
})

export const sessionFlattenedAnnotatedTracesAtom = atom<SessionTraceNode[]>((get) => {
    const traces = get(sessionAnnotatedTracesAtom)
    const flatten = (nodes: SessionTraceNode[]): SessionTraceNode[] => {
        let result: SessionTraceNode[] = []
        nodes.forEach((node) => {
            result.push(node)
            if (node.children) {
                result = [...result, ...flatten(node.children as SessionTraceNode[])]
            }
        })
        return result
    }
    return flatten(traces)
})

export const sessionStatsAtom = atom((get) => {
    const traces = get(sessionAnnotatedTracesAtom)
    if (!traces || !traces.length) return null

    const stats = traces.reduce(
        (acc: any, curr: any) => {
            const metrics = curr.attributes?.ag?.metrics || {}

            // Handle cost
            const cost = metrics.costs?.cumulative?.total || curr.cost || 0

            // Handle tokens
            const tokens =
                metrics.tokens?.cumulative?.total || curr.token_count || curr.total_tokens || 0

            // Handle latency (duration)
            const latency = metrics.duration?.cumulative || curr.latency || 0

            // Handle model
            const model = curr.attributes?.ag?.data?.parameters?.prompt?.llm_config?.model
            return {
                cost: acc.cost + cost,
                token_count: acc.token_count + tokens,
                latency: acc.latency + latency,
                total_tokens: acc.total_tokens + tokens,
                model: model,
            }
        },
        {cost: 0, token_count: 0, latency: 0, total_tokens: 0, model: ""},
    )

    return stats
})

// mutate visibility of annotations
export const isAnnotationVisibleAtom = atomWithStorage("chat-session-annotation-ui", true)

const SESSION_ID_PATTERNS = ["session_id", "session.id", "sessionid", "sessionId", "session-id"]

const normalizeSegment = (segment: string) =>
    segment
        .replace(/\[(\d+)\]/g, ".$1")
        .replace(/["']/g, "")
        .toLowerCase()

const pathMatchesSessionId = (pathSegments: string[]) => {
    if (!pathSegments.length) return false

    const normalized = pathSegments.map(normalizeSegment)
    const joined = normalized.join(".")

    if (SESSION_ID_PATTERNS.some((pattern) => joined.includes(pattern))) {
        return true
    }

    for (let index = 0; index < normalized.length - 1; index += 1) {
        const current = normalized[index]
        const next = normalized[index + 1]

        if (current.includes("session") && next === "id") {
            return true
        }
    }

    return false
}

const deepSearchForSessionId = (
    node: unknown,
    path: string[],
    visited: WeakSet<object>,
): string | null => {
    if (node === null || typeof node !== "object") {
        return null
    }

    if (visited.has(node as object)) {
        return null
    }
    visited.add(node as object)

    if (Array.isArray(node)) {
        for (let index = 0; index < node.length; index += 1) {
            const found = deepSearchForSessionId(node[index], [...path, String(index)], visited)
            if (found) return found
        }
        return null
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const nextPath = [...path, key]

        if (
            pathMatchesSessionId(nextPath) &&
            value != null &&
            (typeof value === "string" || typeof value === "number")
        ) {
            return String(value)
        }

        const found =
            typeof value === "object" && value !== null
                ? deepSearchForSessionId(value, nextPath, visited)
                : null

        if (found) return found
    }

    return null
}

// Helper to extract session_id from trace by traversing all nested attributes
export const getSessionIdFromTrace = (trace: unknown): string | null => {
    if (trace === null || typeof trace !== "object") return null

    try {
        return deepSearchForSessionId(trace, [], new WeakSet<object>())
    } catch {
        return null
    }
}

// Annotation links that reference the current span/trace.
export const sessionDrawerAnnotationLinkTargetsAtom = atom<AnnotationLinkTarget[]>((get) => {
    const activeSpanId = get(sessionDrawerActiveSpanIdAtom)
    if (!activeSpanId) return []

    const traces = get(sessionFlattenedAnnotatedTracesAtom)
    const activeTrace = getNodeById(traces as any, activeSpanId)
    const annotations = get(sessionDrawerAnnotationsAtom)

    const currentTraceId =
        (activeTrace as any)?.invocationIds?.trace_id || (activeTrace as any)?.trace_id
    const currentSpanId =
        (activeTrace as any)?.invocationIds?.span_id || (activeTrace as any)?.span_id

    if (!currentTraceId || !currentSpanId || !Array.isArray(annotations)) return []

    const unique = new Map<string, AnnotationLinkTarget>()

    annotations.forEach((annotation) => {
        const targetTraceId = annotation?.trace_id
        const targetSpanId = annotation?.span_id
        if (!targetTraceId || !targetSpanId) return

        const links = Object.values(annotation?.links || {})
        const isLinkedToCurrent = links.some(
            (link) => link?.trace_id === currentTraceId && link?.span_id === currentSpanId,
        )
        if (!isLinkedToCurrent) return

        const id = `${targetTraceId}:${targetSpanId}`
        if (unique.has(id)) return

        unique.set(id, {
            trace_id: targetTraceId,
            span_id: targetSpanId,
            key: annotation?.meta?.name || annotation?.id,
            type: annotation?.origin || "",
        })
    })

    return Array.from(unique.values())
})

// Fetches traces for annotation-linked targets.
export const sessionDrawerAnnotationLinkTracesQueryAtom = atomWithQuery<
    Record<string, TracesWithAnnotations[]>
>((get) => {
    const targets = get(sessionDrawerAnnotationLinkTargetsAtom)

    return {
        queryKey: ["session-drawer-annotation-links", targets],
        enabled: Array.isArray(targets) && targets.length > 0,
        refetchOnWindowFocus: false,
        queryFn: async () => {
            const uniqueTraceIds = Array.from(new Set(targets.map((t) => t.trace_id)))
            if (!uniqueTraceIds.length) return {} as Record<string, TracesWithAnnotations[]>

            const traceResponses = await Promise.all(
                uniqueTraceIds.map(async (traceId) => {
                    const response = await fetchPreviewTrace(traceId)
                    const tree = response?.response?.tree as AgentaTreeDTO | undefined

                    if (tree) {
                        return {
                            traceId,
                            nodes: observabilityTransformer(tree) as TracesWithAnnotations[],
                        }
                    }

                    const fallback = normalizeTracesResponse(response)
                    if (!fallback) return {traceId, nodes: [] as TracesWithAnnotations[]}

                    return {
                        traceId,
                        nodes: transformTracingResponse(
                            transformTracesResponseToTree(fallback),
                        ) as unknown as TracesWithAnnotations[],
                    }
                }),
            )

            return Object.fromEntries(traceResponses.map(({traceId, nodes}) => [traceId, nodes]))
        },
    }
})

// Cached map of annotation-linked trace trees keyed by trace id.
export const sessionDrawerAnnotationLinkTracesAtom = atom<Record<string, TracesWithAnnotations[]>>(
    (get) => {
        const query = get(sessionDrawerAnnotationLinkTracesQueryAtom)
        return (query.data as Record<string, TracesWithAnnotations[]>) || {}
    },
)

const getReferences = (trace: TracesWithAnnotations) => {
    const allReferences: {key?: string; value: Record<string, any>}[] = []

    const traverseObject = (obj: Record<string, any>, path = "") => {
        if (!obj || typeof obj !== "object") return

        for (const key in obj) {
            if (key === "references") {
                const references = obj[key]

                if (Array.isArray(references)) {
                    // Handle array references
                    references.forEach((ref) => {
                        if (ref.attributes && ref.attributes.key) {
                            const refKey = ref.attributes.key
                            const {attributes, ...refData} = ref
                            allReferences.push({
                                key: refKey,
                                value: refData,
                            })
                        }
                    })
                } else if (typeof references === "object" && references !== null) {
                    // Handle object references
                    Object.entries(references).forEach(([refKey, refValue]) => {
                        allReferences.push({
                            key: refKey,
                            value: refValue as Record<string, any>,
                        })
                    })
                }
            } else if (typeof obj[key] === "object" && obj[key] !== null) {
                // Continue traversing nested objects
                traverseObject(obj[key], path ? `${path}.${key}` : key)
            }
        }
    }

    traverseObject(trace)
    if (!allReferences.length) return []

    const unique = new Map<string, Record<string, any>>()
    const seen = new Set<string>()

    allReferences.forEach(({key, value}) => {
        const identifier = value?.id || value?.slug
        if (identifier) {
            if (seen.has(identifier)) return
            seen.add(identifier)
        }

        const compositeKey = identifier ?? `${key ?? "__no_key__"}-${unique.size}`
        unique.set(compositeKey, {
            ...value,
            key,
            type: "reference",
        })
    })

    return Array.from(unique.values())
}

// Linked spans and reference metadata for the currently active span.
export const sessionDrawerLinksAndReferencesAtom = atom<{
    links: Record<string, any>[]
    references: Record<string, any>[]
}>((get) => {
    const activeSpanId = get(sessionDrawerActiveSpanIdAtom)
    if (!activeSpanId) return {links: [], references: []}

    const traces = get(sessionFlattenedAnnotatedTracesAtom)
    const activeTrace = getNodeById(traces as any, activeSpanId)
    const annotationLinkTargets = get(sessionDrawerAnnotationLinkTargetsAtom)
    const linkedTraces = get(sessionDrawerAnnotationLinkTracesAtom)
    const annotatedTraceTree = get(sessionAnnotatedTracesAtom)

    const currentTraceId =
        (activeTrace as any)?.invocationIds?.trace_id || (activeTrace as any)?.trace_id
    const currentSpanId =
        (activeTrace as any)?.invocationIds?.span_id || (activeTrace as any)?.span_id

    const mergeLinks = (links: Map<string, AnnotationLinkTarget>, link?: AnnotationLinkTarget) => {
        if (!link?.trace_id || !link?.span_id) return
        const id = `${link.trace_id}:${link.span_id}`
        const existing = links.get(id)

        if (existing) {
            links.set(id, {
                ...existing,
                ...link,
                trace: existing.trace?.length ? existing.trace : link.trace,
            })
            return
        }

        const enrichedTrace =
            link.trace_id === currentTraceId && Array.isArray(annotatedTraceTree)
                ? (annotatedTraceTree as unknown as TracesWithAnnotations[])
                : link.trace

        links.set(id, {...link, trace: enrichedTrace})
    }

    const links = new Map<string, AnnotationLinkTarget>()

    const annotationLinks =
        annotationLinkTargets?.map((target) => {
            const nodes = linkedTraces?.[target.trace_id] || []
            const spanNode =
                (getNodeById(nodes as any, target.span_id) as TracesWithAnnotations | null) ||
                undefined

            const trace = nodes?.length ? nodes : undefined

            return {
                ...target,
                trace,
                span: spanNode,
            }
        }) || []

    annotationLinks.forEach((link) => mergeLinks(links, link))

    const annotations = ((activeTrace as unknown as TracesWithAnnotations)?.annotations ||
        []) as AnnotationDto[]

    annotations.forEach((annotation) => {
        const annotationLinks = Object.values(annotation?.links || {}) as Record<string, any>[]
        const annotationKey = annotation?.meta?.name || annotation?.id
        const annotationType = annotation?.origin || annotation?.kind

        annotationLinks.forEach((link) => {
            const traceId = (link as any)?.trace_id
            const spanId = (link as any)?.span_id

            if (!traceId || !spanId) return
            if (traceId === currentTraceId && spanId === currentSpanId) return

            mergeLinks(links, {
                trace_id: traceId,
                span_id: spanId,
                attributes: (link as any)?.attributes,
                key: annotationKey,
                type: annotationType,
                source: (link as any)?.attributes?.type || annotationType,
            })
        })

        if (
            annotation.trace_id &&
            annotation.span_id &&
            (annotation.trace_id !== currentTraceId || annotation.span_id !== currentSpanId)
        ) {
            mergeLinks(links, {
                trace_id: annotation.trace_id,
                span_id: annotation.span_id,
                key: annotationKey,
                type: annotationType,
                source: annotationType,
            })
        }
    })

    const spanLinks = [
        ...(((activeTrace as any)?.otel?.links || []) as SpanLink[]),
        ...(((activeTrace as any)?.links || []) as SpanLink[]),
    ]

    spanLinks.forEach((link) => {
        const traceId = (link as any)?.trace_id || (link as any)?.context?.trace_id
        const spanId = (link as any)?.span_id || (link as any)?.context?.span_id
        if (!traceId || !spanId) return
        if (traceId === currentTraceId && spanId === currentSpanId) return

        mergeLinks(links, {
            trace_id: traceId,
            span_id: spanId,
            attributes: (link as any)?.attributes,
            key: (link as any)?.attributes?.key,
            type: (link as any)?.attributes?.type || (link as any)?.type,
            source: (link as any)?.attributes?.type || (link as any)?.type,
        })
    })

    const references = getReferences((activeTrace as unknown as TracesWithAnnotations) || undefined)

    return {
        links: Array.from(links.values()),
        references,
    }
})

// Helper to check if a trace is a chat session (has session_id in attributes)
export const isChatSessionTrace = (trace: unknown): boolean => {
    try {
        return Boolean(getSessionIdFromTrace(trace))
    } catch {
        return false
    }
}
