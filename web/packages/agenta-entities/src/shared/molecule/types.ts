/**
 * Molecule Types
 *
 * Core type definitions for the entity molecule pattern.
 */

import type {Atom, WritableAtom} from "jotai"
import type {createStore} from "jotai/vanilla"

// Import bridge types for capability interfaces
import type {RunnablePort, LoadableRow, LoadableColumn} from "../entityBridge"

// ============================================================================
// STORE TYPES
// ============================================================================

/**
 * Jotai store type for imperative operations
 */
export type Store = ReturnType<typeof createStore>

/**
 * Options for imperative get/set operations
 */
export interface StoreOptions {
    store?: Store
}

// ============================================================================
// QUERY STATE
// ============================================================================

/**
 * Query state from TanStack Query via jotai-tanstack-query
 */
export interface QueryState<T> {
    /** Server data from the query (undefined while loading, null if explicitly null) */
    data: T | null | undefined
    isPending: boolean
    isError: boolean
    error: Error | null
    isFetching?: boolean
    isSuccess?: boolean
}

// ============================================================================
// ATOM FAMILY TYPES
// ============================================================================

/**
 * A function that creates atoms based on a parameter (like an ID)
 * Includes methods from jotai-family for memory management
 */
export interface AtomFamily<T, P = string> {
    (param: P): Atom<T>
    /** Remove atom for a specific parameter */
    remove: (param: P) => void
    /** Set auto-cleanup policy */
    setShouldRemove: (fn: ((createdAt: number, param: P) => boolean) | null) => void
    /** Get all cached parameters */
    getParams: () => Iterable<P>
}

/**
 * A writable atom family
 * Includes methods from jotai-family for memory management
 */
export interface WritableAtomFamily<T, Args extends unknown[] = [T], P = string> {
    (param: P): WritableAtom<T, Args, void>
    /** Remove atom for a specific parameter */
    remove: (param: P) => void
    /** Set auto-cleanup policy */
    setShouldRemove: (fn: ((createdAt: number, param: P) => boolean) | null) => void
    /** Get all cached parameters */
    getParams: () => Iterable<P>
}

// ============================================================================
// MOLECULE ATOMS
// ============================================================================

/**
 * Core atoms provided by every molecule
 */
export interface MoleculeAtoms<T, TDraft = Partial<T>> {
    /** Entity with draft merged (what UI displays) */
    data: AtomFamily<T | null>
    /** Raw server data (single source of truth) */
    serverData: AtomFamily<T | null | undefined>
    /** Local changes only */
    draft: AtomFamily<TDraft | null>
    /** Query state (isPending, isError, error) */
    query: AtomFamily<QueryState<T>>
    /** Has unsaved local changes */
    isDirty: AtomFamily<boolean>
    /** Entity not yet on server */
    isNew: AtomFamily<boolean>
    /** Entity is marked for deletion */
    isDeleted: AtomFamily<boolean>
    /** IDs of locally created entities (not yet on server) */
    newIds: Atom<string[]>
    /** IDs of entities marked for deletion */
    deletedIds: Atom<Set<string>>
}

// ============================================================================
// MOLECULE REDUCERS
// ============================================================================

/**
 * A reducer atom (write-only atom for mutations)
 * Note: Uses `unknown` for read type since jotai v2 infers this from `atom(null, ...)`
 */
export type Reducer<Args extends unknown[]> = WritableAtom<unknown, Args, void>

/**
 * Core reducers provided by every molecule
 */
export interface MoleculeReducers<TDraft> {
    /** Merge changes into draft */
    update: Reducer<[id: string, changes: TDraft]>
    /** Clear draft, revert to server state */
    discard: Reducer<[id: string]>
    /** Create a new local entity (returns the generated ID) */
    create: Reducer<[data?: TDraft]>
    /** Mark entity as deleted (soft delete until synced) */
    delete: Reducer<[id: string]>
    /** Restore a soft-deleted entity */
    restore: Reducer<[id: string]>
}

// ============================================================================
// IMPERATIVE API
// ============================================================================

/**
 * Imperative getter functions (for callbacks, effects, plain atoms)
 */
export interface MoleculeGetters<T, TDraft = Partial<T>> {
    data: (id: string, options?: StoreOptions) => T | null
    serverData: (id: string, options?: StoreOptions) => T | null | undefined
    draft: (id: string, options?: StoreOptions) => TDraft | null
    query: (id: string, options?: StoreOptions) => QueryState<T>
    isDirty: (id: string, options?: StoreOptions) => boolean
    isNew: (id: string, options?: StoreOptions) => boolean
}

/**
 * Imperative setter functions (for callbacks, effects)
 */
export interface MoleculeSetters<TDraft> {
    update: (id: string, changes: TDraft, options?: StoreOptions) => void
    discard: (id: string, options?: StoreOptions) => void
    /** Create a new local entity, returns the generated ID */
    create: (data?: TDraft, options?: StoreOptions) => string
    /** Mark entity as deleted */
    delete: (id: string, options?: StoreOptions) => void
    /** Restore a soft-deleted entity */
    restore: (id: string, options?: StoreOptions) => void
}

// ============================================================================
// CLEANUP API
// ============================================================================

/**
 * Memory management functions
 */
export interface MoleculeCleanup {
    /** Remove atoms for a specific ID */
    remove: (id: string) => void
    /** Set auto-cleanup policy */
    setShouldRemove: (fn: (createdAt: number, id: string) => boolean) => void
    /** Get all cached IDs (for debugging) */
    getIds: () => string[]
}

// ============================================================================
// LIFECYCLE TYPES
// ============================================================================

/**
 * Lifecycle callback types
 */
export type LifecycleCallback = (id: string) => void

/**
 * Lifecycle unsubscribe function
 */
export type LifecycleUnsubscribe = () => void

/**
 * Lifecycle event types
 */
export type LifecycleEvent = "mount" | "unmount"

/**
 * Lifecycle management API
 *
 * Inspired by bunshi's lifecycle patterns, this provides hooks for
 * when entities are created/destroyed in the atom family cache.
 *
 * @example
 * ```typescript
 * // Subscribe to mount events
 * const unsubscribe = molecule.lifecycle.onMount((id) => {
 *   console.log(`Entity ${id} mounted`)
 * })
 *
 * // Check if entity is active
 * const isActive = molecule.lifecycle.isActive(spanId)
 *
 * // Cleanup when done
 * unsubscribe()
 * ```
 */
export interface MoleculeLifecycle {
    /**
     * Subscribe to mount events (when entity is first accessed)
     * @returns Unsubscribe function
     */
    onMount: (callback: LifecycleCallback) => LifecycleUnsubscribe

    /**
     * Subscribe to unmount events (when entity is removed from cache)
     * @returns Unsubscribe function
     */
    onUnmount: (callback: LifecycleCallback) => LifecycleUnsubscribe

    /**
     * Check if entity is currently in the cache (has been accessed)
     */
    isActive: (id: string) => boolean

    /**
     * Get count of currently active entities
     */
    getActiveCount: () => number
}

// ============================================================================
// REACT HOOK TYPES
// ============================================================================

/**
 * State returned by useController hook
 */
export interface MoleculeState<T> {
    data: T | null
    serverData: T | null | undefined
    isPending: boolean
    isError: boolean
    error: Error | null
    isDirty: boolean
    isNew: boolean
    /** Entity is marked for deletion (soft delete) */
    isDeleted: boolean
}

/**
 * Dispatch object returned by useController hook
 */
export interface MoleculeDispatch<TDraft> {
    update: (changes: TDraft) => void
    discard: () => void
    /** Mark entity for deletion */
    delete: () => void
    /** Restore from soft-delete */
    restore: () => void
}

/**
 * Return type of useController hook
 */
export type UseControllerResult<T, TDraft> = [MoleculeState<T>, MoleculeDispatch<TDraft>]

// ============================================================================
// MOLECULE TYPE
// ============================================================================

/**
 * Complete molecule interface
 */
export interface Molecule<T, TDraft = Partial<T>> {
    /** Molecule name (for debugging) */
    name: string

    /** Atom families for reactive subscriptions */
    atoms: MoleculeAtoms<T, TDraft>

    /** Write operations (reducers) */
    reducers: MoleculeReducers<TDraft>

    /** Imperative read operations */
    get: MoleculeGetters<T, TDraft>

    /** Imperative write operations */
    set: MoleculeSetters<TDraft>

    /** React hook combining atoms + dispatch */
    useController: (id: string) => UseControllerResult<T, TDraft>

    /** Memory management */
    cleanup: MoleculeCleanup

    /**
     * Lifecycle management - subscribe to mount/unmount events
     * Inspired by bunshi's lifecycle patterns
     */
    lifecycle: MoleculeLifecycle
}

// ============================================================================
// CONFIG TYPES
// ============================================================================

/**
 * Lifecycle configuration hooks
 */
export interface LifecycleConfig {
    /**
     * Called when entity is first accessed (added to cache).
     * Use for initialization, logging, or side effects.
     *
     * @example
     * ```typescript
     * onMount: (id) => {
     *   console.log(`Entity ${id} mounted`)
     *   // Start background sync, analytics, etc.
     * }
     * ```
     */
    onMount?: LifecycleCallback

    /**
     * Called when entity is removed from cache.
     * Use for cleanup, resource release, or logging.
     *
     * @example
     * ```typescript
     * onUnmount: (id) => {
     *   console.log(`Entity ${id} unmounted`)
     *   // Stop background processes, cleanup, etc.
     * }
     * ```
     */
    onUnmount?: LifecycleCallback

    /**
     * If true, automatically clear draft state when entity is unmounted.
     * Useful for preventing stale drafts from accumulating.
     * @default false
     */
    clearDraftOnUnmount?: boolean
}

/**
 * A flexible writable atom family that accepts PrimitiveAtom or WritableAtomFamily
 * This allows atoms created with atomFamily(() => atom<T>(null)) to be used
 * since PrimitiveAtom<T> uses SetStateAction<T> which is T | ((prev: T) => T)
 */

export interface FlexibleWritableAtomFamily<T, P = string> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Jotai atoms have specific args types that can't be unified with unknown[]
    (param: P): WritableAtom<T, any[], void>
    /** Remove atom for a specific parameter */
    remove: (param: P) => void
    /** Set auto-cleanup policy */
    setShouldRemove: (fn: ((createdAt: number, param: P) => boolean) | null) => void
    /** Get all cached parameters */
    getParams: () => Iterable<P>
}

/**
 * Configuration for createMolecule factory
 */
export interface CreateMoleculeConfig<T, TDraft = Partial<T>> {
    /** Molecule name (for debugging) */
    name: string

    /** Query atom family - single source of truth for server data */
    queryAtomFamily: AtomFamily<QueryState<T>>

    /**
     * Draft atom family - local changes storage
     * Accepts both WritableAtomFamily and atomFamily(() => atom<T>(null)) patterns
     */
    draftAtomFamily: FlexibleWritableAtomFamily<TDraft | null>

    /**
     * Transform server data before it reaches consumers.
     * Use for date parsing, normalization, field mapping, etc.
     */
    transform?: (serverData: T) => T

    /**
     * Merge function - combines server data with draft
     * @default (server, draft) => draft ? {...server, ...draft} : server
     */
    merge?: (serverData: T | null, draft: TDraft | null) => T | null

    /**
     * Dirty comparison - checks if draft differs from server
     * @default draft !== null
     */
    isDirty?: (serverData: T | null, draft: TDraft | null) => boolean

    /**
     * Check if entity is new (not on server)
     * @default (id) => id.startsWith('new-') || id.startsWith('local-')
     */
    isNewEntity?: (id: string) => boolean

    /**
     * Lifecycle hooks - inspired by bunshi's lifecycle patterns
     * Configure callbacks for mount/unmount events
     */
    lifecycle?: LifecycleConfig
}

// ============================================================================
// LOCAL MOLECULE TYPES (Client-Only Entities)
// ============================================================================

/**
 * Type discriminator for server vs local entities
 */
export type EntitySource = "server" | "local"

/**
 * Base fields present in all server entities
 * These are NOT present in local-only entities
 */
export interface ServerEntityFields {
    id: string
    created_at?: string | null
    updated_at?: string | null
    created_by_id?: string | null
    updated_by_id?: string | null
}

/**
 * Local entity - client-only, no server fields required
 * Uses a local ID (prefixed with 'local-')
 */
export interface LocalEntityFields {
    /** Local ID (prefixed with 'local-') */
    localId: string
    /** Optional label for display */
    label?: string
    /** Timestamp when created locally */
    localCreatedAt: Date
}

/**
 * Query state for local molecules (always successful, never pending)
 */
export interface LocalQueryState<T> {
    data: T | undefined
    isPending: false
    isError: false
    error: null
    isFetching: false
    isSuccess: true
}

/**
 * Configuration for createLocalMolecule factory
 */
export interface CreateLocalMoleculeConfig<T> {
    /** Molecule name (for debugging) */
    name: string

    /**
     * Generate a unique local ID
     * @default () => `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
     */
    generateId?: () => string

    /**
     * Create default data for a new local entity
     * Called when creating a new entity without initial data
     */
    createDefault?: () => T

    /**
     * Validate data before accepting it
     * Should throw if validation fails
     */
    validate?: (data: T) => T

    /**
     * Transform data after setting (for normalization)
     */
    transform?: (data: T) => T
}

/**
 * Local molecule interface - same API as server molecule but for client-only entities
 */
export interface LocalMolecule<T> {
    /** Molecule name (for debugging) */
    name: string

    /** Entity source discriminator */
    source: "local"

    /** Atom families for reactive subscriptions */
    atoms: {
        /** Entity data (same as draft for local) */
        data: AtomFamily<T | null>
        /** Always null for local molecules */
        serverData: AtomFamily<null>
        /** Same as data for local molecules */
        draft: AtomFamily<T | null>
        /** Query state (always successful for local) */
        query: AtomFamily<LocalQueryState<T>>
        /** Always true for local molecules (since there's no server state) */
        isDirty: AtomFamily<boolean>
        /** Always true for local molecules */
        isNew: AtomFamily<boolean>
        /** All local entity IDs */
        allIds: Atom<string[]>
    }

    /** Write operations (reducers) */
    reducers: {
        /** Create a new local entity */
        create: Reducer<[data?: Partial<T>]>
        /** Create with specific ID */
        createWithId: Reducer<[id: string, data: T]>
        /** Update entity data */
        update: Reducer<[id: string, changes: Partial<T>]>
        /** Delete entity (removes from store) */
        delete: Reducer<[id: string]>
        /** Discard (alias for delete in local molecules) */
        discard: Reducer<[id: string]>
        /** Clear all local entities */
        clear: Reducer<[]>
    }

    /** Imperative read operations */
    get: {
        data: (id: string, options?: StoreOptions) => T | null
        allIds: (options?: StoreOptions) => string[]
        all: (options?: StoreOptions) => T[]
    }

    /** Imperative write operations */
    set: {
        create: (data?: Partial<T>, options?: StoreOptions) => string
        createWithId: (id: string, data: T, options?: StoreOptions) => void
        update: (id: string, changes: Partial<T>, options?: StoreOptions) => void
        delete: (id: string, options?: StoreOptions) => void
        clear: (options?: StoreOptions) => void
    }

    /** React hook combining state + dispatch */
    useController: (id: string) => UseControllerResult<T, Partial<T>>

    /** Memory management */
    cleanup: MoleculeCleanup

    /** Generate a new local ID */
    generateId: () => string
}

// ============================================================================
// CACHE REDIRECT TYPES
// ============================================================================

/**
 * Cache key configuration for query deduplication
 */
export interface CacheKeyConfig {
    /** Primary cache key (used for query deduplication) */
    primary: (id: string) => string[]
    /** Alternate keys that should redirect to primary */
    redirects?: {
        /** Pattern to match (e.g., 'bySlug' for looking up by slug) */
        pattern: string
        /** Function to resolve to primary ID */
        resolve: (value: string) => string | Promise<string>
    }[]
}

/**
 * Cache redirect entry for manual cache population
 */
export interface CacheRedirectEntry<T> {
    /** The ID to redirect from */
    fromId: string
    /** The ID to redirect to (where data actually lives) */
    toId: string
    /** Optional: Direct data to populate */
    data?: T
}

/**
 * Extended molecule config with cache redirect support
 */
export interface CacheConfig<T> {
    /** Cache key configuration */
    keys?: CacheKeyConfig

    /**
     * Populate cache from external source
     * Useful when entity is fetched as part of another query
     */
    populateFrom?: (data: T) => void

    /**
     * Get data from cache without triggering fetch
     */
    getFromCache?: (id: string, options?: StoreOptions) => T | null

    /**
     * Manually set cache entry
     */
    setInCache?: (id: string, data: T, options?: StoreOptions) => void

    /**
     * Invalidate cache for ID
     */
    invalidate?: (id: string, options?: StoreOptions) => void

    /**
     * Invalidate all cache entries
     */
    invalidateAll?: (options?: StoreOptions) => void
}

// ============================================================================
// MOLECULE COMPOSITION TYPES
// ============================================================================

/**
 * Relation configuration for molecule composition
 */
export interface MoleculeRelation<TParent, TChild> {
    /** Name of the relation */
    name: string

    /** Path to child IDs in parent data */
    childIdsPath: string | ((parent: TParent) => string[])

    /** Path to inline child data (if embedded) */
    childDataPath?: string | ((parent: TParent) => TChild[] | undefined)

    /** The child molecule */
    childMolecule: Molecule<TChild, unknown> | LocalMolecule<TChild>

    /**
     * How to handle embedded data:
     * - 'populate': Write embedded data to child molecule's cache
     * - 'reference': Just store IDs, fetch children separately
     */
    mode: "populate" | "reference"
}

/**
 * Molecule with relations to other molecules
 */
export interface MoleculeWithRelations<
    T,
    TDraft,
    TRelations extends Record<string, MoleculeRelation<T, unknown>>,
> extends Molecule<T, TDraft> {
    /** Relation configurations */
    relations: TRelations

    /** Get child entities for a parent */
    getChildren: <K extends keyof TRelations>(
        parentId: string,
        relationName: K,
        options?: StoreOptions,
    ) => TRelations[K] extends MoleculeRelation<T, infer TChild> ? TChild[] : never

    /** Atom to subscribe to child IDs */
    childIdsAtom: <K extends keyof TRelations>(parentId: string, relationName: K) => Atom<string[]>
}

// ============================================================================
// ENTITY RELATION TYPES
// ============================================================================

/**
 * Query state for list queries (used by selection UI)
 */
export interface ListQueryState<T> {
    data: T[]
    isPending: boolean
    isError: boolean
    error: Error | null
}

/**
 * Selection UI metadata for a relation
 */
export interface RelationSelectionConfig {
    /** Display label for this level */
    label: string
    /** Icon to show (React node or icon name) */
    icon?: unknown
    /** How to display an entity in the list */
    displayName?: (entity: unknown) => string
    /** Auto-select if only one item */
    autoSelectSingle?: boolean
    /** Auto-select the latest (most recent) item */
    autoSelectLatest?: boolean
}

/**
 * Binding configuration for entity connections (e.g., loadable-runnable)
 */
export interface RelationBindingConfig {
    /** Generate a binding ID from parent type and ID */
    getId: (parentType: string, parentId: string) => string
    /** Parse a binding ID back to parent info */
    parseId: (bindingId: string) => {type: string; id: string} | null
}

/**
 * Extended relation interface with selection and binding metadata.
 *
 * Extends `MoleculeRelation` to support:
 * - Selection UI generation (for EntityPicker, adapters)
 * - Entity binding (for loadable-runnable connections)
 * - List atom families (for hierarchical navigation)
 *
 * @example
 * ```typescript
 * const testcaseRelation: EntityRelation<Revision, Testcase> = {
 *   name: "testcases",
 *   parentType: "revision",
 *   childType: "testcase",
 *   childIdsPath: (rev) => rev.data?.testcase_ids ?? [],
 *   childDataPath: (rev) => rev.data?.testcases,
 *   childMolecule: testcaseMolecule,
 *   mode: "populate",
 *   selection: {
 *     label: "Testcase",
 *     autoSelectSingle: true,
 *   },
 * }
 * ```
 */
export interface EntityRelation<TParent, TChild> extends MoleculeRelation<TParent, TChild> {
    /** Parent entity type identifier (e.g., "revision", "app", "testset") */
    parentType: string

    /** Child entity type identifier (e.g., "testcase", "variant", "revision") */
    childType: string

    /**
     * Atom family that returns a list of children given a parent ID.
     * Used by selection UIs to populate dropdown/list options.
     */
    listAtomFamily?: (parentId: string) => Atom<ListQueryState<TChild>>

    /** Selection UI metadata */
    selection?: RelationSelectionConfig

    /** Binding configuration (for loadable/runnable connections) */
    binding?: RelationBindingConfig
}

/**
 * Type guard to check if a relation has selection config
 */
export function hasSelectionConfig<TParent, TChild>(
    relation: EntityRelation<TParent, TChild>,
): relation is EntityRelation<TParent, TChild> & {selection: RelationSelectionConfig} {
    return relation.selection !== undefined
}

/**
 * Type guard to check if a relation has binding config
 */
export function hasBindingConfig<TParent, TChild>(
    relation: EntityRelation<TParent, TChild>,
): relation is EntityRelation<TParent, TChild> & {binding: RelationBindingConfig} {
    return relation.binding !== undefined
}

// ============================================================================
// TYPE UTILITIES FOR STRICT TYPING
// ============================================================================

/**
 * Infer entity type from a Zod schema
 * Use this to ensure molecule types match API schemas
 *
 * @example
 * ```typescript
 * import { z } from 'zod'
 *
 * const testcaseSchema = z.object({
 *   id: z.string(),
 *   data: z.record(z.string(), z.any()),
 * })
 *
 * type Testcase = InferSchemaType<typeof testcaseSchema>
 * // Testcase is now { id: string; data: Record<string, any> }
 * ```
 */
export type InferSchemaType<T> = T extends {_output: infer O} ? O : never

/**
 * Create a server entity type with required server fields
 */
export type ServerEntity<T> = T & ServerEntityFields

/**
 * Create a local entity type (without server fields)
 */
export type LocalEntity<T> = Omit<T, keyof ServerEntityFields> & LocalEntityFields

/**
 * Union type for entities that can be either server or local
 */
export type AnyEntity<T> = ServerEntity<T> | LocalEntity<T>

/**
 * Check if entity is local
 */
export function isLocalEntity<T>(entity: AnyEntity<T>): entity is LocalEntity<T> {
    return "localId" in entity
}

/**
 * Check if entity is from server
 */
export function isServerEntity<T>(entity: AnyEntity<T>): entity is ServerEntity<T> {
    return "id" in entity && !("localId" in entity)
}

/**
 * Get entity ID regardless of source
 */
export function getEntityId<T>(entity: AnyEntity<T>): string {
    return isLocalEntity(entity) ? entity.localId : (entity as ServerEntity<T>).id
}

// ============================================================================
// PUBLIC API INTERFACES
// ============================================================================

// Note: RunnablePort, LoadableRow, LoadableColumn are defined in entityBridge.ts
// and re-exported from there to avoid duplication.

/**
 * Base entity controller interface.
 *
 * All entities implement this uniform interface, providing:
 * - **atoms**: Reactive subscriptions for useAtomValue and atom compositions
 * - **actions**: Write atoms for use in other atoms with set()
 * - **get**: Imperative reads for callbacks outside React/atom context
 * - **set**: Imperative writes for callbacks outside React/atom context
 *
 * @example
 * ```typescript
 * // Reactive subscription
 * const data = useAtomValue(entity.atoms.data(id))
 *
 * // Write in atom composition
 * set(entity.actions.update, id, { name: 'New Name' })
 *
 * // Imperative (callbacks)
 * const data = entity.get.data(id)
 * entity.set.update(id, changes)
 * ```
 */
export interface EntityController<T, TDraft = Partial<T>> {
    /**
     * Reactive atoms for subscribing to entity state.
     * Use with `useAtomValue` or in atom compositions with `get()`.
     */
    atoms: {
        /**
         * Entity data with local draft merged.
         * @param id - Entity ID
         * @returns Atom that resolves to entity data or null if not found
         */
        data: AtomFamily<T | null>
        /**
         * Local draft changes only.
         * @param id - Entity ID
         * @returns Atom that resolves to draft or null if no changes
         */
        draft: AtomFamily<TDraft | null>
        /**
         * Whether entity has unsaved local changes.
         * @param id - Entity ID
         * @returns Atom that resolves to boolean
         */
        isDirty: AtomFamily<boolean>
        /**
         * Query state (isPending, isError, error).
         * @param id - Entity ID
         * @returns Atom that resolves to QueryState
         */
        query: AtomFamily<QueryState<T>>
    }

    /**
     * Write atoms for use in other atoms with `set()`.
     * These maintain correct Jotai store context in atom compositions.
     *
     * @example
     * ```typescript
     * const saveAtom = atom(null, (get, set) => {
     *   set(entity.actions.update, id, changes)
     *   set(entity.actions.discard, id)
     * })
     * ```
     */
    actions: {
        /**
         * Update entity draft with partial changes.
         * Usage: `set(entity.actions.update, id, changes)`
         */
        update: Reducer<[id: string, changes: TDraft]>
        /**
         * Discard all local changes, revert to server state.
         * Usage: `set(entity.actions.discard, id)`
         */
        discard: Reducer<[id: string]>
    }

    /**
     * Imperative read operations for callbacks outside React/atom context.
     * These read directly from the Jotai store.
     */
    get: {
        /**
         * Get entity data with draft merged.
         * @param id - Entity ID
         * @returns Entity data or null if not found
         */
        data: (id: string, options?: StoreOptions) => T | null
        /**
         * Check if entity has unsaved local changes.
         * @param id - Entity ID
         * @returns True if entity has local changes
         */
        isDirty: (id: string, options?: StoreOptions) => boolean
    }

    /**
     * Imperative write operations for callbacks outside React/atom context.
     * These write directly to the Jotai store.
     */
    set: {
        /**
         * Update entity draft with partial changes.
         * @param id - Entity ID
         * @param changes - Partial changes to merge into draft
         */
        update: (id: string, changes: TDraft, options?: StoreOptions) => void
        /**
         * Discard all local changes, revert to server state.
         * @param id - Entity ID
         */
        discard: (id: string, options?: StoreOptions) => void
    }
}

/**
 * Runnable capability interface.
 *
 * Entities that are runnable (appRevision, evaluator) implement this interface,
 * providing access to input/output ports, configuration, and invocation URL.
 *
 * @example
 * ```typescript
 * // Get input ports for a runnable
 * const inputPorts = useAtomValue(appRevision.runnable.inputPorts(id))
 *
 * // Get configuration
 * const config = useAtomValue(appRevision.runnable.config(id))
 *
 * // Get invocation URL
 * const url = useAtomValue(appRevision.runnable.invocationUrl(id))
 * ```
 */
export interface RunnableCapability {
    /**
     * Runnable-specific atoms for input/output ports and configuration.
     */
    runnable: {
        /**
         * Input port definitions for this runnable.
         * @param id - Entity ID
         * @returns Atom that resolves to array of input ports
         */
        inputPorts: AtomFamily<RunnablePort[]>
        /**
         * Output port definitions for this runnable.
         * @param id - Entity ID
         * @returns Atom that resolves to array of output ports
         */
        outputPorts: AtomFamily<RunnablePort[]>
        /**
         * Configuration object for this runnable.
         * @param id - Entity ID
         * @returns Atom that resolves to configuration or null
         */
        config: AtomFamily<Record<string, unknown> | null>
        /**
         * URL to invoke this runnable.
         * @param id - Entity ID
         * @returns Atom that resolves to URL string or null
         */
        invocationUrl: AtomFamily<string | null>
    }
}

/**
 * Loadable capability interface.
 *
 * Entities that are loadable (testcase) implement this interface,
 * providing access to rows, columns, and change tracking.
 *
 * @example
 * ```typescript
 * // Get rows for a revision
 * const rows = useAtomValue(testcase.loadable.rows(revisionId))
 *
 * // Get column definitions
 * const columns = useAtomValue(testcase.loadable.columns(revisionId))
 *
 * // Check for changes
 * const hasChanges = useAtomValue(testcase.loadable.hasChanges(revisionId))
 * ```
 */
export interface LoadableCapability {
    /**
     * Loadable-specific atoms for rows, columns, and change tracking.
     */
    loadable: {
        /**
         * Rows for the given revision.
         * @param revisionId - Revision ID (not entity ID)
         * @returns Atom that resolves to array of rows
         */
        rows: AtomFamily<LoadableRow[]>
        /**
         * Column definitions for the given revision.
         * @param revisionId - Revision ID (not entity ID)
         * @returns Atom that resolves to array of columns
         */
        columns: AtomFamily<LoadableColumn[]>
        /**
         * Whether the revision has unsaved changes.
         * @param revisionId - Revision ID (not entity ID)
         * @returns Atom that resolves to boolean
         */
        hasChanges: AtomFamily<boolean>
    }
}

/**
 * Combined entity type with runnable capability.
 * Use this type for entities like appRevision and evaluator.
 */
export type RunnableEntity<T, TDraft = Partial<T>> = EntityController<T, TDraft> &
    RunnableCapability

/**
 * Combined entity type with loadable capability.
 * Use this type for entities like testcase.
 */
export type LoadableEntity<T, TDraft = Partial<T>> = EntityController<T, TDraft> &
    LoadableCapability

/**
 * Combined entity type with both runnable and loadable capabilities.
 * Reserved for future entities that might need both.
 */
export type RunnableLoadableEntity<T, TDraft = Partial<T>> = EntityController<T, TDraft> &
    RunnableCapability &
    LoadableCapability

// ============================================================================
// EXTENSION TYPES
// ============================================================================

/**
 * Any atom family - supports any param type (string, object, etc.)
 * Used for flexible extension atoms like cell accessor with {id, column} param
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Function params are contravariant, unknown can't be assigned from specific types
export type AnyAtomFamily = (param: any) => Atom<unknown>

/**
 * Any writable atom - supports any args and return type
 * Used for reducers that return values (not just void)
 * Note: Uses `any` for all type params due to Jotai type system requirements
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyWritableAtom = WritableAtom<any, any[], any>

/**
 * Additional atoms to add via extendMolecule
 * Supports:
 * - AtomFamily<T> with string param (standard)
 * - AtomFamily with compound key (e.g., {id, column})
 * - Plain Atom<T> (non-parameterized)
 */

export type ExtendedAtoms<T = unknown> = Record<
    string,
    AtomFamily<T, string> | AnyAtomFamily | Atom<unknown>
>

/**
 * Additional reducers to add via extendMolecule
 * Supports:
 * - Standard Reducer<Args> with void return
 * - Reducers that return values (e.g., {id, data} or number)
 */
export type ExtendedReducers = Record<string, AnyWritableAtom>

/**
 * Additional getters to add via extendMolecule
 * Supports any function signature, not just (id, options) => unknown
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Function params are contravariant, needs any for flexible signatures
export type ExtendedGetters = Record<string, (...args: any[]) => unknown>

/**
 * Additional setters to add via extendMolecule
 * Supports any function signature with any return type
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Function params are contravariant, needs any for flexible signatures
export type ExtendedSetters = Record<string, (...args: any[]) => unknown>

/**
 * Configuration for extendMolecule
 */
export interface ExtendMoleculeConfig<
    TAtoms extends ExtendedAtoms = Record<string, never>,
    TReducers extends ExtendedReducers = Record<string, never>,
    TGetters extends ExtendedGetters = Record<string, never>,
    TSetters extends ExtendedSetters = Record<string, never>,
> {
    atoms?: TAtoms
    reducers?: TReducers
    get?: TGetters
    set?: TSetters
}

/**
 * Extended molecule type with additional features
 */
export type ExtendedMolecule<
    T,
    TDraft,
    TAtoms extends ExtendedAtoms,
    TReducers extends ExtendedReducers,
    TGetters extends ExtendedGetters,
    TSetters extends ExtendedSetters,
> = Molecule<T, TDraft> & {
    atoms: MoleculeAtoms<T, TDraft> & TAtoms
    reducers: MoleculeReducers<TDraft> & TReducers
    get: MoleculeGetters<T, TDraft> & TGetters
    set: MoleculeSetters<TDraft> & TSetters
}
