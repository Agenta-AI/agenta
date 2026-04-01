/**
 * Annotation Molecule
 *
 * Unified API for annotation entity state management.
 * Follows the molecule pattern for consistency with other entities.
 *
 * Annotations are keyed by a composite `traceId:spanId` string.
 * Use `encodeAnnotationId(traceId, spanId)` to create the key.
 *
 * Unlike most entities, `selectors.data` returns `Annotation[]` (not a single entity)
 * because multiple annotations can exist for the same trace/span pair
 * (different evaluators, different users).
 *
 * @example
 * ```typescript
 * import { annotationMolecule, encodeAnnotationId } from '@agenta/entities/annotation'
 *
 * // Selectors (reactive)
 * const compositeId = encodeAnnotationId(traceId, spanId)
 * const annotations = useAtomValue(annotationMolecule.selectors.data(compositeId))
 * const isDirty = useAtomValue(annotationMolecule.selectors.isDirty(compositeId))
 *
 * // Imperative API (outside React)
 * const annotations = annotationMolecule.get.data(compositeId)
 * ```
 *
 * @packageDocumentation
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {createBatchFetcher} from "@agenta/shared/utils"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import type {StoreOptions} from "../../shared"
import {queryAnnotations} from "../api"
import {type Annotation, encodeAnnotationId, decodeAnnotationId} from "../core"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

// ============================================================================
// BATCH FETCHER
// ============================================================================

interface AnnotationBatchRequest {
    projectId: string
    traceId: string
    spanId: string
}

/**
 * Batch fetcher that collects concurrent annotation requests and fetches
 * them in a single `POST /preview/annotations/query` call.
 *
 * Groups by projectId, deduplicates by (traceId, spanId) pair.
 * Indexes results by both the annotation's own trace_id:span_id AND
 * by all `links[*].trace_id:span_id` entries — matching how the
 * legacy `EvalRunDetails/atoms/annotations.ts` batch fetcher works.
 */
const annotationBatchFetcher = createBatchFetcher<AnnotationBatchRequest, Annotation[]>({
    serializeKey: (req) => `${req.projectId}:${encodeAnnotationId(req.traceId, req.spanId)}`,
    maxBatchSize: 50,
    batchFn: async (requests, serializedKeys) => {
        const results: Record<string, Annotation[]> = {}

        // Group by projectId
        const byProject = new Map<
            string,
            {links: {trace_id: string; span_id: string}[]; keys: string[]}
        >()

        requests.forEach((req, idx) => {
            const key = serializedKeys[idx]
            if (!req.projectId || !req.traceId || !req.spanId) {
                results[key] = []
                return
            }

            const existing = byProject.get(req.projectId)
            if (existing) {
                existing.links.push({trace_id: req.traceId, span_id: req.spanId})
                existing.keys.push(key)
            } else {
                byProject.set(req.projectId, {
                    links: [{trace_id: req.traceId, span_id: req.spanId}],
                    keys: [key],
                })
            }
        })

        // Fetch each project's annotations in parallel
        await Promise.all(
            Array.from(byProject.entries()).map(async ([projectId, group]) => {
                try {
                    const response = await queryAnnotations({
                        projectId,
                        annotationLinks: group.links,
                    })

                    // Index annotations by composite key
                    // An annotation can be found by:
                    // 1. Its own trace_id:span_id
                    // 2. Any link entry's trace_id:span_id
                    const byCompositeKey = new Map<string, Set<Annotation>>()

                    const addToKey = (compositeKey: string, ann: Annotation) => {
                        const fullKey = `${projectId}:${compositeKey}`
                        if (!byCompositeKey.has(fullKey)) {
                            byCompositeKey.set(fullKey, new Set())
                        }
                        byCompositeKey.get(fullKey)!.add(ann)
                    }

                    for (const ann of response.annotations) {
                        // Index by own trace_id:span_id
                        if (ann.trace_id && ann.span_id) {
                            addToKey(encodeAnnotationId(ann.trace_id, ann.span_id), ann)
                        }

                        // Index by all link entries
                        if (ann.links) {
                            for (const link of Object.values(ann.links)) {
                                if (link.trace_id && link.span_id) {
                                    addToKey(encodeAnnotationId(link.trace_id, link.span_id), ann)
                                }
                            }
                        }
                    }

                    // Resolve each request key
                    group.keys.forEach((key) => {
                        const annSet = byCompositeKey.get(key)
                        results[key] = annSet ? Array.from(annSet) : []
                    })
                } catch (error) {
                    console.error("[annotationBatchFetcher] Failed:", error)
                    group.keys.forEach((key) => {
                        results[key] = []
                    })
                }
            }),
        )

        return results
    },
})

// ============================================================================
// QUERY ATOM FAMILY
// ============================================================================

/**
 * Query atom family for fetching annotations by composite ID.
 *
 * The composite ID is `encodeAnnotationId(traceId, spanId)`.
 * Returns `Annotation[]` because multiple annotations can exist
 * for the same trace/span pair (different evaluators/users).
 *
 * Uses the batch fetcher so concurrent requests are coalesced
 * into a single API call.
 */
export const annotationQueryAtomFamily = atomFamily((compositeId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        let traceId = ""
        let spanId = ""
        if (compositeId) {
            try {
                const decoded = decodeAnnotationId(compositeId)
                traceId = decoded.traceId
                spanId = decoded.spanId
            } catch {
                // Invalid composite ID — query will be disabled
            }
        }

        return {
            queryKey: ["annotation", compositeId, projectId],
            queryFn: async (): Promise<Annotation[]> => {
                if (!projectId || !traceId || !spanId) return []
                return annotationBatchFetcher({projectId, traceId, spanId})
            },
            enabled: get(sessionAtom) && !!projectId && !!traceId && !!spanId,
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
        }
    }),
)

// ============================================================================
// DRAFT STATE
// ============================================================================

/**
 * Draft state for annotation edits.
 * Keyed by composite ID.
 */
export interface AnnotationDraft {
    data?: {outputs?: Record<string, unknown>}
    meta?: {name?: string; description?: string; tags?: string[]}
}

/**
 * Per-composite-key draft atom.
 */
export const annotationDraftAtomFamily = atomFamily((_compositeId: string) =>
    atom<AnnotationDraft | null>(null),
)

/**
 * Is the annotation dirty (has local edits)?
 */
export const annotationIsDirtyAtomFamily = atomFamily((compositeId: string) =>
    atom<boolean>((get) => {
        return get(annotationDraftAtomFamily(compositeId)) !== null
    }),
)

// ============================================================================
// MUTATIONS (Write Atoms)
// ============================================================================

/**
 * Update annotation draft state.
 */
export const updateAnnotationDraftAtom = atom(
    null,
    (_get, set, compositeId: string, updates: AnnotationDraft) => {
        const current = _get(annotationDraftAtomFamily(compositeId))
        set(annotationDraftAtomFamily(compositeId), {
            ...current,
            ...updates,
            data: {...current?.data, ...updates.data},
            meta: {...current?.meta, ...updates.meta},
        })
    },
)

/**
 * Discard annotation draft (reset to server state).
 */
export const discardAnnotationDraftAtom = atom(null, (_get, set, compositeId: string) => {
    set(annotationDraftAtomFamily(compositeId), null)
})

// ============================================================================
// CACHE INVALIDATION
// ============================================================================

/**
 * Invalidate annotation cache for a composite ID.
 */
export function invalidateAnnotationCache(compositeId: string, options?: StoreOptions) {
    const store = getStore(options)
    const current = store.get(annotationQueryAtomFamily(compositeId))
    if (current?.refetch) {
        current.refetch()
    }
}

/**
 * Invalidate annotation cache by trace_id + span_id pair.
 * Convenience wrapper around `invalidateAnnotationCache`.
 */
export function invalidateAnnotationCacheByLink(
    traceId: string,
    spanId: string,
    options?: StoreOptions,
) {
    invalidateAnnotationCache(encodeAnnotationId(traceId, spanId), options)
}

// ============================================================================
// DERIVED SELECTORS
// ============================================================================

/**
 * Annotations data selector (raw list from query).
 */
const dataAtomFamily = atomFamily((compositeId: string) =>
    atom<Annotation[]>((get) => {
        const query = get(annotationQueryAtomFamily(compositeId))
        return query.data ?? []
    }),
)

/**
 * Annotations query state selector.
 */
const queryAtomFamily = atomFamily((compositeId: string) =>
    atom((get) => {
        const query = get(annotationQueryAtomFamily(compositeId))
        return {
            data: query.data ?? [],
            isPending: query.isPending,
            isError: query.isError,
            error: query.error ?? null,
        }
    }),
)

// ============================================================================
// MOLECULE DEFINITION
// ============================================================================

/**
 * Annotation molecule — unified API for annotation entity state.
 *
 * Keyed by composite `traceId:spanId` string.
 * Returns `Annotation[]` (not single entity) per key.
 */
export const annotationMolecule = {
    // ========================================================================
    // SELECTORS (reactive atom families)
    // ========================================================================
    selectors: {
        /** All annotations for a given trace_id:span_id */
        data: dataAtomFamily,
        /** Query state (loading, error) */
        query: queryAtomFamily,
        /** Has local draft edits */
        isDirty: annotationIsDirtyAtomFamily,
    },

    // ========================================================================
    // ATOMS (raw store atoms)
    // ========================================================================
    atoms: {
        /** Per-composite-key query */
        query: annotationQueryAtomFamily,
        /** Per-composite-key draft */
        draft: annotationDraftAtomFamily,
        /** Per-composite-key dirty flag */
        isDirty: annotationIsDirtyAtomFamily,
    },

    // ========================================================================
    // ACTIONS (write atoms)
    // ========================================================================
    actions: {
        /** Update annotation draft */
        update: updateAnnotationDraftAtom,
        /** Discard annotation draft */
        discard: discardAnnotationDraftAtom,
    },

    // ========================================================================
    // GET (imperative read API)
    // ========================================================================
    get: {
        data: (compositeId: string, options?: StoreOptions) =>
            getStore(options).get(dataAtomFamily(compositeId)),
        isDirty: (compositeId: string, options?: StoreOptions) =>
            getStore(options).get(annotationIsDirtyAtomFamily(compositeId)),
        draft: (compositeId: string, options?: StoreOptions) =>
            getStore(options).get(annotationDraftAtomFamily(compositeId)),
    },

    // ========================================================================
    // SET (imperative write API)
    // ========================================================================
    set: {
        update: (compositeId: string, draft: AnnotationDraft, options?: StoreOptions) =>
            getStore(options).set(updateAnnotationDraftAtom, compositeId, draft),
        discard: (compositeId: string, options?: StoreOptions) =>
            getStore(options).set(discardAnnotationDraftAtom, compositeId),
    },

    // ========================================================================
    // CACHE (invalidation utilities)
    // ========================================================================
    cache: {
        /** Invalidate by composite ID */
        invalidate: invalidateAnnotationCache,
        /** Invalidate by trace_id + span_id pair */
        invalidateByLink: invalidateAnnotationCacheByLink,
    },
}

export type AnnotationMolecule = typeof annotationMolecule
