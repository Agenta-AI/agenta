import {produce} from "immer"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import type {
    BaseEntity,
    EntityMetadata,
    EntityStore,
    EntityStoreConfig,
    StoredEntity,
} from "./types"

const DEFAULT_STALE_TIME = 60_000 // 1 minute
const DEFAULT_GC_TIME = 5 * 60 * 1000 // 5 minutes

/**
 * Creates a complete entity management store with atoms for CRUD operations,
 * normalized caching, and automatic hydration from list queries.
 *
 * @example
 * ```ts
 * const testcaseStore = createEntityStore({
 *   name: 'testcase',
 *   schema: testcaseSchema,
 *   extractEntities: (response) => response.testcases,
 *   fetchList: async ({ revisionId }) => api.fetchTestcases(revisionId),
 * })
 * ```
 */
export function createEntityStore<
    TEntity extends BaseEntity,
    TListParams extends Record<string, any>,
    TListResponse,
    TDetailParams extends Record<string, any> = {id: string},
>(
    config: EntityStoreConfig<TEntity, TListParams, TListResponse, TDetailParams>,
): EntityStore<TEntity, TListParams, TListResponse, TDetailParams> {
    const {
        name,
        schema,
        staleTime = DEFAULT_STALE_TIME,
        gcTime = DEFAULT_GC_TIME,
        extractEntities,
        fetchList,
        fetchDetail,
        normalize = (entity) => entity,
        createOptimistic: _createOptimistic,
    } = config

    // =========================================================================
    // NORMALIZED STORAGE
    // =========================================================================

    /**
     * Core storage: Record<id, StoredEntity>
     * All entities live here with metadata
     */
    const entitiesAtom = atom<Record<string, StoredEntity<TEntity>>>({})

    // =========================================================================
    // UTILITIES
    // =========================================================================

    /** Check if entity is stale */
    const isStale = (metadata: EntityMetadata): boolean => {
        return metadata.isStale || Date.now() - metadata.fetchedAt > staleTime
    }

    /** Create fresh metadata */
    const createMetadata = (partial?: Partial<EntityMetadata>): EntityMetadata => ({
        fetchedAt: Date.now(),
        isStale: false,
        isDirty: false,
        ...partial,
    })

    /** Validate and normalize entity */
    const processEntity = (raw: unknown): TEntity => {
        const validated = schema.parse(raw)
        return normalize(validated)
    }

    // =========================================================================
    // MUTATIONS
    // =========================================================================

    /**
     * Upsert a single entity into the store
     */
    const upsertAtom = atom(null, (get, set, entity: TEntity) => {
        const processed = processEntity(entity)
        const existing = get(entitiesAtom)[processed.id]

        set(entitiesAtom, (prev) => ({
            ...prev,
            [processed.id]: {
                data: processed,
                metadata: existing?.metadata.isDirty
                    ? existing.metadata // Preserve dirty state
                    : createMetadata(),
            },
        }))
    })

    /**
     * Upsert multiple entities (for list hydration)
     */
    const upsertManyAtom = atom(null, (get, set, entities: TEntity[]) => {
        const prev = get(entitiesAtom)
        const next = {...prev}

        entities.forEach((entity) => {
            const processed = processEntity(entity)
            const existing = prev[processed.id]

            next[processed.id] = {
                data: processed,
                metadata: existing?.metadata.isDirty
                    ? existing.metadata // Preserve dirty state
                    : createMetadata(),
            }
        })

        set(entitiesAtom, next)
    })

    /**
     * Remove entity from store
     */
    const removeAtom = atom(null, (get, set, id: string) => {
        set(entitiesAtom, (prev) => {
            const next = {...prev}
            delete next[id]
            return next
        })
    })

    /**
     * Update entity with partial data (local draft)
     */
    const updateAtom = atom(
        null,
        (get, set, {id, updates}: {id: string; updates: Partial<TEntity>}) => {
            set(entitiesAtom, (prev) => {
                const existing = prev[id]
                if (!existing) return prev

                return {
                    ...prev,
                    [id]: {
                        data: {...existing.data, ...updates} as TEntity,
                        metadata: {
                            ...existing.metadata,
                            isDirty: true,
                        },
                    },
                }
            })
        },
    )

    /**
     * Mark entities as stale
     */
    const invalidateAtom = atom(null, (get, set, ids: string | string[]) => {
        const idArray = Array.isArray(ids) ? ids : [ids]

        set(entitiesAtom, (prev) =>
            produce(prev, (draft) => {
                idArray.forEach((id) => {
                    if (draft[id]) {
                        draft[id].metadata.isStale = true
                    }
                })
            }),
        )
    })

    /**
     * Clear all stale entities from cache
     */
    const clearStaleAtom = atom(null, (get, set) => {
        set(entitiesAtom, (prev) => {
            const next: Record<string, StoredEntity<TEntity>> = {}
            Object.entries(prev).forEach(([id, stored]) => {
                if (!isStale(stored.metadata)) {
                    next[id] = stored
                }
            })
            return next
        })
    })

    /**
     * Clear dirty flag on all entities (after successful save)
     */
    const clearAllDirtyAtom = atom(null, (get, set) => {
        set(entitiesAtom, (prev) =>
            produce(prev, (draft) => {
                Object.values(draft).forEach((stored) => {
                    stored.metadata.isDirty = false
                })
            }),
        )
    })

    /**
     * Clear dirty flag on a single entity (e.g., after discarding changes)
     */
    const clearDirtyAtom = atom(null, (get, set, id: string) => {
        set(entitiesAtom, (prev) => {
            const existing = prev[id]
            if (!existing) return prev

            return {
                ...prev,
                [id]: {
                    ...existing,
                    metadata: {
                        ...existing.metadata,
                        isDirty: false,
                    },
                },
            }
        })
    })

    /**
     * Clear entire entity cache
     */
    const clearAllAtom = atom(null, (get, set) => {
        set(entitiesAtom, {})
    })

    // =========================================================================
    // QUERIES
    // =========================================================================

    /**
     * List query with automatic cache hydration
     */
    const listQueryAtom = atomFamily((params: TListParams) =>
        atomWithQuery((get) => ({
            queryKey: [name, "list", params],
            queryFn: async () => {
                const response = await fetchList(params)

                // Hydrate normalized store
                const _entities = extractEntities(response)
                get(upsertManyAtom) // Access the atom to trigger subscription
                // We need to use set, but atomWithQuery doesn't give us set
                // So we'll handle hydration in the hook layer instead

                return response
            },
            staleTime,
            gcTime,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
        })),
    )

    /**
     * Detail query with cache-first approach
     */
    const detailQueryAtom = atomFamily((params: TDetailParams) =>
        atomWithQuery((get) => {
            const allEntities = get(entitiesAtom)
            const id = (params as any).id as string
            const cached = allEntities[id]

            return {
                queryKey: [name, "detail", params],
                queryFn: async () => {
                    if (!fetchDetail) {
                        // No detail fetcher - rely on normalized store
                        return cached?.data ?? null
                    }

                    const entity = await fetchDetail(params)
                    return entity
                },
                // Use cached data as placeholder if fresh
                placeholderData: cached && !isStale(cached.metadata) ? cached.data : undefined,
                enabled: fetchDetail ? true : Boolean(cached),
                staleTime,
                gcTime,
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
            }
        }),
    )

    // =========================================================================
    // SELECTORS
    // =========================================================================

    /**
     * Get single entity by ID (read-only)
     */
    const entityAtomFamily = atomFamily((id: string) =>
        atom((get) => {
            const stored = get(entitiesAtom)[id]
            return stored?.data ?? null
        }),
    )

    /**
     * Get entity metadata by ID (for checking isDirty, isStale, etc.)
     */
    const entityMetadataAtomFamily = atomFamily((id: string) =>
        atom((get) => {
            const stored = get(entitiesAtom)[id]
            return stored?.metadata ?? null
        }),
    )

    /**
     * Select a slice of a single entity
     */
    const selectEntity = <TResult>(id: string, selector: (entity: TEntity) => TResult) => {
        return selectAtom(
            entityAtomFamily(id),
            (entity) => (entity ? selector(entity) : null),
            Object.is,
        )
    }

    /**
     * Select across all entities
     */
    const selectEntities = <TResult>(selector: (entities: Record<string, TEntity>) => TResult) => {
        return selectAtom(
            entitiesAtom,
            (stored) => {
                const entities: Record<string, TEntity> = {}
                Object.entries(stored).forEach(([id, {data}]) => {
                    entities[id] = data
                })
                return selector(entities)
            },
            Object.is,
        )
    }

    // =========================================================================
    // RETURN INTERFACE
    // =========================================================================

    return {
        // Core atoms
        entitiesAtom,
        entityAtomFamily,
        entityMetadataAtomFamily,

        // Query atoms
        listQueryAtom,
        detailQueryAtom,

        // Mutation atoms
        upsertAtom,
        upsertManyAtom,
        removeAtom,
        updateAtom,

        // Utility atoms
        invalidateAtom,
        clearStaleAtom,
        clearDirtyAtom,
        clearAllDirtyAtom,
        clearAllAtom,

        // Selectors
        selectEntity,
        selectEntities,
    }
}
