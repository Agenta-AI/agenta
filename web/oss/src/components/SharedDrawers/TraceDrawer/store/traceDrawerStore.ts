import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomWithImmer} from "jotai-immer"
import {atomWithQuery} from "jotai-tanstack-query"

import {attachAnnotationsToTraces} from "@/oss/lib/hooks/useAnnotations/assets/helpers"
import {transformApiData} from "@/oss/lib/hooks/useAnnotations/assets/transformer"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"
import {getNodeById, observabilityTransformer} from "@/oss/lib/traces/observability_helpers"
import {queryAllAnnotations} from "@/oss/services/annotations/api"
import {AgentaTreeDTO, TracesWithAnnotations} from "@/oss/services/observability/types"
import {fetchPreviewTrace} from "@/oss/services/tracing/api"
import {
    transformTracesResponseToTree,
    transformTracingResponse,
} from "@/oss/services/tracing/lib/helpers"
import {SpanLink, TracesResponse} from "@/oss/services/tracing/types"
import {getOrgValues} from "@/oss/state/org"

export type TraceDrawerSpanLink = SpanLink & {key?: string}
interface AnnotationLinkTarget {
    trace_id: string
    span_id: string
    key?: string
    type?: string
    source?: string
    attributes?: Record<string, any>
    trace?: TracesWithAnnotations[]
}
// Linked span row surfaced in the linked spans table.
export type LinkedSpanRow = TracesWithAnnotations & {linkKey?: string; linkSource?: string}

export interface TraceDrawerState {
    open: boolean
    traceId: string | null
    activeSpanId: string | null
    originTraceId: string | null
    history: {traceId: string; spanId: string | null}[]
}

export const initialTraceDrawerState: TraceDrawerState = {
    open: false,
    traceId: null,
    activeSpanId: null,
    originTraceId: null,
    history: [],
}

// Holds the full trace drawer state (open/trace/span/history).
export const traceDrawerAtom = atomWithImmer<TraceDrawerState>(initialTraceDrawerState)
// Derived atom for whether the drawer is open.
export const isDrawerOpenAtom = atom((get) => get(traceDrawerAtom).open)
// Current trace id being shown in the drawer.
export const traceDrawerTraceIdAtom = atom((get) => get(traceDrawerAtom).traceId)
// Current active span id within the drawer.
export const traceDrawerActiveSpanIdAtom = atom((get) => get(traceDrawerAtom).activeSpanId)

// Closes the drawer without clearing its content.
export const closeTraceDrawerAtom = atom(null, (_get, set) => {
    set(traceDrawerAtom, (draft) => {
        draft.open = false
    })
})

// Opens the drawer with a specific trace/span selection.
export const openTraceDrawerAtom = atom(
    null,
    (_get, set, payload: {traceId: string; activeSpanId?: string | null}) => {
        set(traceDrawerAtom, (draft) => {
            draft.open = true
            draft.traceId = payload.traceId
            draft.activeSpanId = payload.activeSpanId ?? null
            draft.originTraceId = payload.traceId
            draft.history = []
        })
    },
)

// Updates the active span id within the current trace.
export const setTraceDrawerActiveSpanAtom = atom(null, (_get, set, activeSpanId: string | null) => {
    set(traceDrawerAtom, (draft) => {
        draft.activeSpanId = activeSpanId
    })
})

// Navigates to a trace/span inside the drawer (handles history).
export const setTraceDrawerTraceAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            traceId?: string
            activeSpanId?: string | null
            source?: "external" | "linked" | "back"
        } | null,
    ) => {
        const {traceId: targetId, activeSpanId, source = "external"} = payload || {}

        if (source === "back") {
            set(traceDrawerAtom, (draft) => {
                const previous = draft.history.pop()
                if (!previous) return
                draft.traceId = previous.traceId
                draft.activeSpanId = previous.spanId ?? null
            })
            return
        }

        if (!targetId) return

        set(traceDrawerAtom, (draft) => {
            if (source === "linked" && draft.traceId && targetId !== draft.traceId) {
                draft.history.push({traceId: draft.traceId, spanId: draft.activeSpanId})
                if (!draft.originTraceId) {
                    draft.originTraceId = draft.traceId
                }
            } else if (source === "external") {
                draft.originTraceId = targetId
                draft.history = []
            }

            draft.traceId = targetId
            if (activeSpanId !== undefined) {
                draft.activeSpanId = activeSpanId
            } else if (source === "external" && targetId !== draft.traceId) {
                draft.activeSpanId = null
            }
        })
    },
)

// Fetches the currently selected trace.
export const traceDrawerQueryAtom = atomWithQuery((get) => {
    const traceId = get(traceDrawerTraceIdAtom)

    return {
        queryKey: ["trace-drawer", traceId ?? "none"],
        enabled: Boolean(traceId),
        refetchOnWindowFocus: false,
        queryFn: async () => {
            if (!traceId) return null
            return fetchPreviewTrace(traceId)
        },
    }
})

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

const flattenTraces = (nodes: TracesWithAnnotations[]): TracesWithAnnotations[] => {
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

export const traceDrawerBaseTracesAtom = atom<TracesWithAnnotations[]>((get) => {
    const {data: traceResponse} = get(traceDrawerQueryAtom)
    const tree = traceResponse?.response?.tree as AgentaTreeDTO | undefined

    if (tree) {
        return observabilityTransformer(tree) as TracesWithAnnotations[]
    }

    const fallback = normalizeTracesResponse(traceResponse)
    if (!fallback) return []

    return transformTracingResponse(
        transformTracesResponseToTree(fallback),
    ) as unknown as TracesWithAnnotations[]
})

// Flattens transformed traces for easier span lookup.
export const traceDrawerFlatBaseTracesAtom = atom<TracesWithAnnotations[]>((get) =>
    flattenTraces(get(traceDrawerBaseTracesAtom)),
)

// Collects trace/span ids for annotation fetching.
export const traceDrawerAnnotationLinksAtom = atom<{trace_id: string; span_id: string}[]>((get) =>
    get(traceDrawerFlatBaseTracesAtom).map((node) => ({
        trace_id: node?.invocationIds?.trace_id || (node as any)?.trace_id,
        span_id: node?.invocationIds?.span_id || (node as any)?.span_id,
    })),
)

// Queries annotations for spans displayed in the drawer.
export const traceDrawerAnnotationsQueryAtom = atomWithQuery((get) => {
    const links = get(traceDrawerAnnotationLinksAtom)
    const {selectedOrg} = getOrgValues()
    const members = selectedOrg?.default_workspace?.members || []

    return {
        queryKey: ["trace-drawer-annotations", links],
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

// Resolved annotations list for the drawer traces.
export const traceDrawerAnnotationsAtom = atom((get) => {
    const query = get(traceDrawerAnnotationsQueryAtom)
    return (query.data as AnnotationDto[]) ?? []
})

// Base traces with annotations attached when available.
export const senitizedTracesAtom = atom<TracesWithAnnotations[]>((get) => {
    const base = get(traceDrawerBaseTracesAtom)
    const annotations = get(traceDrawerAnnotationsAtom)
    if (!base.length) return [] as TracesWithAnnotations[]
    if (annotations === undefined) return base
    return attachAnnotationsToTraces(base, annotations) as TracesWithAnnotations[]
})

// Flattened annotated traces for quick lookup.
export const traceDrawerFlatAnnotatedTracesAtom = atom<TracesWithAnnotations[]>((get) =>
    flattenTraces(get(senitizedTracesAtom)),
)

// Annotation links that reference the current span/trace.
export const annotationLinkTargetsAtom = atom<AnnotationLinkTarget[]>((get) => {
    const activeSpanId = get(traceDrawerActiveSpanIdAtom)
    if (!activeSpanId) return []

    const traces = get(traceDrawerFlatAnnotatedTracesAtom)
    const activeTrace = getNodeById(traces as any, activeSpanId)
    const annotations = get(traceDrawerAnnotationsAtom)

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
export const annotationLinkTracesQueryAtom = atomWithQuery<Record<string, TracesWithAnnotations[]>>(
    (get) => {
        const targets = get(annotationLinkTargetsAtom)

        return {
            queryKey: ["trace-drawer-annotation-links", targets],
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

                return Object.fromEntries(
                    traceResponses.map(({traceId, nodes}) => [traceId, nodes]),
                )
            },
        }
    },
)

// Cached map of annotation-linked trace trees keyed by trace id.
export const annotationLinkTracesAtom = atom<Record<string, TracesWithAnnotations[]>>((get) => {
    const query = get(annotationLinkTracesQueryAtom)
    return (query.data as Record<string, TracesWithAnnotations[]>) || {}
})

// Consolidates link targets from annotations/trace with any inlined trace data.
export const linkedSpanTargetsAtom = atom<AnnotationLinkTarget[]>((get) => {
    const payload = get(linksAndReferencesAtom)
    const links = Array.isArray(payload?.links) ? payload.links : []

    const unique = new Map<string, AnnotationLinkTarget>()

    links.forEach((link) => {
        const traceId = (link as any)?.trace_id || (link as any)?.context?.trace_id
        const spanId = (link as any)?.span_id || (link as any)?.context?.span_id

        if (!traceId || !spanId) return

        const id = `${traceId}:${spanId}`
        const next = {
            trace_id: traceId,
            span_id: spanId,
            key: (link as any)?.key,
            type: (link as any)?.type || (link as any)?.source,
            source: (link as any)?.attributes?.source || (link as any)?.source,
            attributes: (link as any)?.attributes,
            trace: Array.isArray((link as any)?.trace) ? (link as any).trace : undefined,
        }
        if (unique.has(id)) {
            const existing = unique.get(id) as AnnotationLinkTarget
            unique.set(id, {
                ...existing,
                ...next,
                trace: existing.trace?.length ? existing.trace : next.trace,
            })
            return
        }

        unique.set(id, next)
    })

    return Array.from(unique.values())
})

// Fetches traces for linked targets that were not provided inline.
export const linkedSpanTracesQueryAtom = atomWithQuery<Record<string, TracesWithAnnotations[]>>(
    (get) => {
        const targets = get(linkedSpanTargetsAtom)

        return {
            queryKey: ["trace-drawer-linked-spans", targets],
            enabled: Array.isArray(targets) && targets.length > 0,
            refetchOnWindowFocus: false,
            queryFn: async () => {
                const providedTraceIds = targets
                    .filter((t) => Array.isArray(t.trace))
                    .map((t) => t.trace_id)
                const missingTraceIds = Array.from(
                    new Set(
                        targets
                            .map((t) => t.trace_id)
                            .filter((traceId) => !providedTraceIds.includes(traceId)),
                    ),
                )

                const traceResponses = await Promise.all(
                    missingTraceIds.map(async (traceId) => {
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

                return Object.fromEntries(
                    traceResponses.map(({traceId, nodes}) => [traceId, nodes]),
                )
            },
        }
    },
)

// Map of trace id to trace tree for linked spans (provided + fetched).
export const linkedSpanTracesAtom = atom<Record<string, TracesWithAnnotations[]>>((get) => {
    const targets = get(linkedSpanTargetsAtom)
    const fetched = get(linkedSpanTracesQueryAtom).data || {}

    const map = new Map<string, TracesWithAnnotations[]>()
    targets.forEach((target) => {
        if (Array.isArray(target.trace)) {
            map.set(target.trace_id, target.trace)
        }
    })

    Object.entries(fetched as Record<string, TracesWithAnnotations[]>).forEach(([id, nodes]) => {
        map.set(id, nodes)
    })

    return Object.fromEntries(map)
})

// Final linked span rows consumed by the linked spans table.
export const linkedSpansAtom = atom<LinkedSpanRow[]>((get) => {
    const targets = get(linkedSpanTargetsAtom)
    const traceMap = get(linkedSpanTracesAtom)
    const flattenedCache = new Map<string, TracesWithAnnotations[]>()

    return targets.reduce<LinkedSpanRow[]>((rows, target) => {
        const nodes = traceMap[target.trace_id] || []
        const flattened = flattenedCache.get(target.trace_id) || flattenTraces(nodes)
        if (!flattenedCache.has(target.trace_id)) {
            flattenedCache.set(target.trace_id, flattened)
        }

        const spanNode =
            (getNodeById(nodes as any, target.span_id) as TracesWithAnnotations | null) ||
            (flattened.find((item) => item.span_id === target.span_id) as
                | TracesWithAnnotations
                | undefined)

        if (!spanNode) return rows

        const inferredSource =
            target.source ||
            target.type ||
            (target.attributes as Record<string, any> | undefined)?.type ||
            (spanNode as any)?.span_type

        rows.push({
            ...(spanNode as TracesWithAnnotations),
            trace_id: (spanNode as any)?.trace_id || target.trace_id,
            span_id: (spanNode as any)?.span_id || target.span_id,
            key: `${target.trace_id}-${target.span_id}`,
            linkKey: target.key,
            linkSource: inferredSource || undefined,
        })

        return rows
    }, [])
})

// Resolves the active span id to a valid span in loaded traces.
export const traceDrawerResolvedActiveSpanIdAtom = atom<string | null>((get) => {
    const flatTraces = get(traceDrawerFlatAnnotatedTracesAtom)
    const requestedActive = get(traceDrawerActiveSpanIdAtom)
    if (!flatTraces.length) return null
    if (requestedActive && flatTraces.some((t) => t.span_id === requestedActive)) {
        return requestedActive
    }
    return flatTraces[0]?.span_id || null
})

// Utility getter to find a trace node by id.
export const traceDrawerGetTraceByIdAtom = atom((get) => {
    const traces = get(senitizedTracesAtom)
    return (id?: string) => {
        if (!id) return undefined
        const found = getNodeById(traces as any, id)
        return (found as TracesWithAnnotations) || undefined
    }
})

// Previous trace/span navigation target for "back" behavior.
export const traceDrawerBackTargetAtom = atom<{traceId: string; spanId: string | null} | null>(
    (get) => {
        const state = get(traceDrawerAtom)
        if (!state.history.length) return null
        return state.history[state.history.length - 1] || null
    },
)

// Indicates whether user is currently viewing a linked trace (not the origin).
export const traceDrawerIsLinkedViewAtom = atom((get) => {
    const state = get(traceDrawerAtom)
    return Boolean(
        state.originTraceId &&
            state.traceId &&
            state.originTraceId !== state.traceId &&
            state.history.length >= 0,
    )
})

// ------------------------------------------------------------------

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
export const linksAndReferencesAtom = atom<{
    links: Record<string, any>[]
    references: Record<string, any>[]
}>((get) => {
    const activeSpanId = get(traceDrawerActiveSpanIdAtom)
    if (!activeSpanId) return {}

    const traces = get(traceDrawerFlatAnnotatedTracesAtom)
    const activeTrace = getNodeById(traces as any, activeSpanId)
    const annotatedTraceTree = get(senitizedTracesAtom)
    const annotationLinkTargets = get(annotationLinkTargetsAtom)
    const linkedTraces = get(annotationLinkTracesAtom)

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
                ? annotatedTraceTree
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

    const references = getReferences(activeTrace || undefined)

    return {
        links: Array.from(links.values()),
        references,
    }
})

// Persisted toggle for the trace side panel (annotations/details) visibility.
export const traceSidePanelOpenAtom = atomWithStorage<boolean>(
    "observability-trace-side-panel-open",
    true,
)
