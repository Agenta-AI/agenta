import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"
import {atomWithQuery} from "jotai-tanstack-query"
import {atomWithStorage} from "jotai/utils"

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
import {SpanLink, TraceSpanNode, TracesResponse} from "@/oss/services/tracing/types"
import {getOrgValues} from "@/oss/state/org"

export type TraceDrawerSpanLink = SpanLink & {key?: string}

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

export const traceDrawerAtom = atomWithImmer<TraceDrawerState>(initialTraceDrawerState)
export const traceDrawerSpanLinksAtom = atom<TraceDrawerSpanLink[]>([])

export const isDrawerOpenAtom = atom((get) => get(traceDrawerAtom).open)
export const traceDrawerTraceIdAtom = atom((get) => get(traceDrawerAtom).traceId)
export const traceDrawerActiveSpanIdAtom = atom((get) => get(traceDrawerAtom).activeSpanId)

export const resetTraceDrawerAtom = atom(null, (_get, set) => {
    set(traceDrawerAtom, initialTraceDrawerState)
    set(traceDrawerSpanLinksAtom, [])
})

export const closeTraceDrawerAtom = atom(null, (_get, set) => {
    set(traceDrawerAtom, (draft) => {
        draft.open = false
    })
})

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

export const setTraceDrawerActiveSpanAtom = atom(null, (_get, set, activeSpanId: string | null) => {
    set(traceDrawerAtom, (draft) => {
        draft.activeSpanId = activeSpanId
    })
})

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

export const setTraceDrawerSpanLinksAtom = atom(
    null,
    (_get, set, links: TraceDrawerSpanLink[] | null | undefined) => {
        set(traceDrawerSpanLinksAtom, links ?? [])
    },
)

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

export const traceDrawerFlatBaseTracesAtom = atom<TracesWithAnnotations[]>((get) =>
    flattenTraces(get(traceDrawerBaseTracesAtom)),
)

export const traceDrawerAnnotationLinksAtom = atom<{trace_id: string; span_id: string}[]>((get) =>
    get(traceDrawerFlatBaseTracesAtom).map((node) => ({
        trace_id: node?.invocationIds?.trace_id || (node as any)?.trace_id,
        span_id: node?.invocationIds?.span_id || (node as any)?.span_id,
    })),
)

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

export const traceDrawerAnnotationsAtom = atom((get) => {
    const query = get(traceDrawerAnnotationsQueryAtom)
    return (query.data as AnnotationDto[]) ?? []
})

export const senitizedTracesAtom = atom<TracesWithAnnotations[]>((get) => {
    const base = get(traceDrawerBaseTracesAtom)
    const annotations = get(traceDrawerAnnotationsAtom)
    if (!base.length) return [] as TracesWithAnnotations[]
    if (annotations === undefined) return base
    return attachAnnotationsToTraces(base, annotations) as TracesWithAnnotations[]
})

export const traceDrawerFlatAnnotatedTracesAtom = atom<TracesWithAnnotations[]>((get) =>
    flattenTraces(get(senitizedTracesAtom)),
)

export const traceDrawerResolvedActiveSpanIdAtom = atom<string | null>((get) => {
    const flatTraces = get(traceDrawerFlatAnnotatedTracesAtom)
    const requestedActive = get(traceDrawerActiveSpanIdAtom)
    if (!flatTraces.length) return null
    if (requestedActive && flatTraces.some((t) => t.span_id === requestedActive)) {
        return requestedActive
    }
    return flatTraces[0]?.span_id || null
})

export const traceDrawerGetTraceByIdAtom = atom((get) => {
    const traces = get(senitizedTracesAtom)
    return (id?: string) => {
        if (!id) return undefined
        const found = getNodeById(traces as any, id)
        return (found as TracesWithAnnotations) || undefined
    }
})

export const traceDrawerBackTargetAtom = atom<{traceId: string; spanId: string | null} | null>(
    (get) => {
        const state = get(traceDrawerAtom)
        if (!state.history.length) return null
        return state.history[state.history.length - 1] || null
    },
)

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

const getLinks = (trace: TracesWithAnnotations) => {
    const allLinks = {}

    const traverseObject = (obj: Record<string, any>, path = "") => {
        if (!obj || typeof obj !== "object") return

        for (const key in obj) {
            if (key === "links" && typeof obj[key] === "object") {
                // Found a links object, merge its contents into allLinks
                Object.assign(allLinks, obj[key])
            } else if (typeof obj[key] === "object" && obj[key] !== null) {
                // Continue traversing nested objects
                traverseObject(obj[key], path ? `${path}.${key}` : key)
            }
        }
    }

    traverseObject(trace)

    if (!allLinks) return []
    const formattedLinks = new Set([])
    Object.entries(allLinks || {})?.forEach(([key, value]) => {
        formattedLinks.add({
            ...value,
            key,
            type: "link",
        })
    })

    return Array.from(formattedLinks)
}

const getReferences = (trace: TracesWithAnnotations) => {
    const allReferences: Array<{key?: string; value: Record<string, any>}> = []

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

export const linksAndReferencesAtom = atom<{
    links: Record<string, any>[]
    references: Record<string, any>[]
}>((get) => {
    const activeSpanId = get(traceDrawerActiveSpanIdAtom)
    if (!activeSpanId) return {}

    const traces = get(traceDrawerFlatAnnotatedTracesAtom)
    const activeTrace = getNodeById(traces as any, activeSpanId)
    // extract links
    const links = getLinks(activeTrace || undefined)

    // extract references
    const references = getReferences(activeTrace || undefined)

    return {
        links,
        references,
    }
})

type LinkedSpanTarget = {
    trace_id: string
    span_id: string
    key?: string
    type?: string
    source?: string
}

export const linkedSpansTabActiveAtom = atom(false)

export const linkedSpanTargetsAtom = atom<LinkedSpanTarget[]>((get) => {
    const payload = get(linksAndReferencesAtom)
    const links = Array.isArray(payload?.links) ? payload.links : []

    const unique = new Map<string, LinkedSpanTarget>()

    links.forEach((link) => {
        const traceId = (link as any)?.trace_id || (link as any)?.context?.trace_id
        const spanId = (link as any)?.span_id || (link as any)?.context?.span_id

        if (!traceId || !spanId) return

        const id = `${traceId}:${spanId}`

        if (unique.has(id)) return

        unique.set(id, {
            trace_id: traceId,
            span_id: spanId,
            key: link.key,
            type: link.type,
            source: (link as any)?.attributes?.source,
        })
    })

    return Array.from(unique.values())
})

export type LinkedSpanRow = TraceSpanNode & {linkKey?: string; linkSource?: string}

export const linkedSpansQueryAtom = atomWithQuery<LinkedSpanRow[]>((get) => {
    const isTabActive = get(linkedSpansTabActiveAtom)
    const targets = get(linkedSpanTargetsAtom)

    return {
        queryKey: ["trace-drawer-linked-spans", targets],
        enabled: isTabActive && Array.isArray(targets) && targets.length > 0,
        refetchOnWindowFocus: false,
        queryFn: async () => {
            const uniqueTraceIds = Array.from(new Set(targets.map((t) => t.trace_id)))

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

            const traceMap = new Map<string, TracesWithAnnotations[]>(
                traceResponses.map(({traceId, nodes}) => [traceId, nodes]),
            )

            const flattenedCache = new Map<string, TracesWithAnnotations[]>()

            const rows: LinkedSpanRow[] = []

            targets.forEach((target) => {
                const nodes = traceMap.get(target.trace_id) || []
                const flattened = flattenedCache.get(target.trace_id) || flattenTraces(nodes)
                if (!flattenedCache.has(target.trace_id)) {
                    flattenedCache.set(target.trace_id, flattened)
                }

                const spanNode =
                    (getNodeById(nodes as any, target.span_id) as TracesWithAnnotations | null) ||
                    (flattened.find((item) => item.span_id === target.span_id) as
                        | TracesWithAnnotations
                        | undefined)

                if (!spanNode) return

                rows.push({
                    ...spanNode,
                    trace_id: spanNode.trace_id || target.trace_id,
                    span_id: spanNode.span_id || target.span_id,
                    key: `${target.trace_id}-${target.span_id}`,
                    linkKey: target.key,
                    linkSource: target.source || target.type || target.key,
                })
            })

            return rows
        },
    }
})

export const linkedSpansAtom = atom<LinkedSpanRow[]>((get) => {
    const query = get(linkedSpansQueryAtom)
    return query.data ?? []
})

// Persisted toggle for the trace side panel (annotations/details) visibility
export const traceSidePanelOpenAtom = atomWithStorage<boolean>(
    "observability-trace-side-panel-open",
    true,
)
