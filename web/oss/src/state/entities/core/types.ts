import type {Atom, WritableAtom} from "jotai"
import type {z} from "zod"

/**
 * Base entity interface - all entities must have an id
 */
export interface BaseEntity {
    id: string
    [key: string]: any
}

/**
 * Metadata tracked for each entity
 */
export interface EntityMetadata {
    fetchedAt: number
    isStale: boolean
    isDirty: boolean
    /** Entity created locally, not yet saved to server */
    isNew: boolean
    /** Entity marked for deletion */
    isDeleted: boolean
}

/**
 * Stored entity with metadata
 */
export interface StoredEntity<T extends BaseEntity> {
    data: T
    metadata: EntityMetadata
}

/**
 * Configuration for creating an entity store
 */
export interface EntityStoreConfig<
    TEntity extends BaseEntity,
    TListParams extends Record<string, any>,
    TListResponse,
    TDetailParams extends Record<string, any>,
> {
    /** Unique name for this entity type */
    name: string

    /** Zod schema for entity validation */
    schema: z.ZodType<TEntity>

    /** How long cached data is considered fresh (ms) */
    staleTime?: number

    /** Garbage collection time for unused entities (ms) */
    gcTime?: number

    /** Extract entities from list response */
    extractEntities: (response: TListResponse) => TEntity[]

    /** Fetch a list of entities */
    fetchList: (params: TListParams) => Promise<TListResponse>

    /** Fetch a single entity (optional - will use normalized store if not provided) */
    fetchDetail?: (params: TDetailParams) => Promise<TEntity>

    /** Optional: Transform entity before storing */
    normalize?: (entity: TEntity) => TEntity

    /** Optional: Generate optimistic entity */
    createOptimistic?: (partial: Partial<TEntity>) => TEntity
}

/**
 * The entity store returned by createEntityStore
 */
export interface EntityStore<
    TEntity extends BaseEntity,
    TListParams extends Record<string, any>,
    TListResponse,
    TDetailParams extends Record<string, any>,
> {
    // Core atoms
    entitiesAtom: WritableAtom<Record<string, StoredEntity<TEntity>>, [any], any>
    entityAtomFamily: (id: string) => Atom<TEntity | null>
    entityMetadataAtomFamily: (id: string) => Atom<EntityMetadata | null>

    // Query atoms
    listQueryAtom: (params: TListParams) => Atom<Promise<TListResponse>>
    detailQueryAtom: (params: TDetailParams) => Atom<Promise<TEntity | null>>

    // Mutation atoms
    upsertAtom: WritableAtom<null, [TEntity], void>
    upsertManyAtom: WritableAtom<null, [TEntity[]], void>
    removeAtom: WritableAtom<null, [string], void>
    updateAtom: WritableAtom<null, [{id: string; updates: Partial<TEntity>}], void>

    // New/Deleted entity management
    createEntityAtom: WritableAtom<null, [TEntity], void>
    markDeletedAtom: WritableAtom<null, [string], void>
    unmarkDeletedAtom: WritableAtom<null, [string], void>
    removeNewEntityAtom: WritableAtom<null, [string], void>
    clearNewDeletedAtom: WritableAtom<null, [], void>

    // New/Deleted selectors
    newEntityIdsAtom: Atom<string[]>
    deletedEntityIdsAtom: Atom<Set<string>>
    newEntitiesAtom: Atom<TEntity[]>
    hasNewOrDeletedAtom: Atom<boolean>

    // Utility atoms
    invalidateAtom: WritableAtom<null, [string | string[]], void>
    clearStaleAtom: WritableAtom<null, [], void>
    clearDirtyAtom: WritableAtom<null, [string], void>
    clearAllDirtyAtom: WritableAtom<null, [], void>
    clearAllAtom: WritableAtom<null, [], void>

    // Selectors
    selectEntity: (id: string, selector: (entity: TEntity) => any) => Atom<any>
    selectEntities: (selector: (entities: Record<string, TEntity>) => any) => Atom<any>
}

/**
 * Draft state for local edits before server sync
 */
export interface DraftState<T extends BaseEntity> {
    original: T | null
    current: T
    patches: any[] // Immer patches
    isDirty: boolean
}

/**
 * Batch fetcher configuration
 */
export interface BatchFetcherConfig<TRequest, TResponse, TBatchResponse> {
    /** Serialize request to cache key */
    serializeKey: (request: TRequest) => string

    /** Batch multiple requests into one API call */
    batchFn: (requests: TRequest[], serializedKeys: string[]) => Promise<TBatchResponse>

    /** Extract individual response from batch response */
    resolveResult: (
        batchResponse: TBatchResponse,
        request: TRequest,
        serializedKey: string,
    ) => TResponse | null

    /** Max time to wait for batching (ms) */
    maxWaitTime?: number

    /** Max batch size */
    maxBatchSize?: number
}
