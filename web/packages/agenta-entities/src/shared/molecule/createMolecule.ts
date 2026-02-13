/**
 * createMolecule Factory
 *
 * Creates a base molecule with all core functionality for entity state management.
 * Uses jotai-family for explicit memory management.
 */

import {atom, useAtomValue, useSetAtom} from "jotai"
import type {Atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import type {
    AtomFamily,
    CreateMoleculeConfig,
    LifecycleCallback,
    LifecycleUnsubscribe,
    Molecule,
    MoleculeAtoms,
    MoleculeCleanup,
    MoleculeDispatch,
    MoleculeGetters,
    MoleculeLifecycle,
    MoleculeReducers,
    MoleculeSetters,
    MoleculeState,
    QueryState,
    Reducer,
    StoreOptions,
    UseControllerResult,
} from "./types"

// ============================================================================
// ID GENERATION
// ============================================================================

let idCounter = 0

/**
 * Generate a unique local ID for new entities
 */
function generateLocalId(): string {
    idCounter += 1
    return `new-${Date.now()}-${idCounter}`
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get the store to use for imperative operations
 */
function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

/**
 * Default merge function - shallow merge draft into server data
 */
function defaultMerge<T, TDraft>(serverData: T | null, draft: TDraft | null): T | null {
    if (!serverData) return null
    if (!draft) return serverData
    return {...serverData, ...draft} as T
}

/**
 * Default dirty check - draft exists means dirty
 */
function defaultIsDirty<T, TDraft>(_serverData: T | null, draft: TDraft | null): boolean {
    return draft !== null
}

/**
 * Default new entity check
 */
function defaultIsNewEntity(id: string): boolean {
    return id.startsWith("new-") || id.startsWith("local-")
}

// ============================================================================
// LIFECYCLE TRACKING
// ============================================================================

/**
 * Creates a lifecycle tracker for entity mount/unmount events.
 *
 * Inspired by bunshi's lifecycle patterns, this tracks when entities
 * are first accessed (mount) and removed (unmount) from the cache.
 */
function createLifecycleTracker() {
    // Track active entity IDs
    const activeIds = new Set<string>()

    // Subscribers for mount/unmount events
    const mountCallbacks = new Set<LifecycleCallback>()
    const unmountCallbacks = new Set<LifecycleCallback>()

    return {
        /**
         * Track that an entity was mounted (first accessed)
         */
        mount(id: string) {
            if (!activeIds.has(id)) {
                activeIds.add(id)
                mountCallbacks.forEach((cb) => cb(id))
            }
        },

        /**
         * Track that an entity was unmounted (removed from cache)
         */
        unmount(id: string) {
            if (activeIds.has(id)) {
                activeIds.delete(id)
                unmountCallbacks.forEach((cb) => cb(id))
            }
        },

        /**
         * Subscribe to mount events
         */
        onMount(callback: LifecycleCallback): LifecycleUnsubscribe {
            mountCallbacks.add(callback)
            return () => mountCallbacks.delete(callback)
        },

        /**
         * Subscribe to unmount events
         */
        onUnmount(callback: LifecycleCallback): LifecycleUnsubscribe {
            unmountCallbacks.add(callback)
            return () => unmountCallbacks.delete(callback)
        },

        /**
         * Check if entity is currently active
         */
        isActive(id: string): boolean {
            return activeIds.has(id)
        },

        /**
         * Get count of active entities
         */
        getActiveCount(): number {
            return activeIds.size
        },

        /**
         * Get all active IDs (for debugging)
         */
        getActiveIds(): string[] {
            return Array.from(activeIds)
        },
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Creates a base molecule with all core functionality.
 *
 * @example
 * ```typescript
 * const testcaseMolecule = createMolecule({
 *   name: 'testcase',
 *   queryAtomFamily: testcaseQueryFamily,
 *   draftAtomFamily: testcaseDraftFamily,
 *   transform: normalizeTimestamps,
 * })
 * ```
 */
export function createMolecule<T, TDraft = Partial<T>>(
    config: CreateMoleculeConfig<T, TDraft>,
): Molecule<T, TDraft> {
    const {
        name,
        queryAtomFamily,
        draftAtomFamily,
        transform,
        merge = defaultMerge,
        isDirty: isDirtyFn = defaultIsDirty,
        isNewEntity = defaultIsNewEntity,
        lifecycle: lifecycleConfig,
    } = config

    // ========================================================================
    // LIFECYCLE TRACKER
    // ========================================================================

    const lifecycleTracker = createLifecycleTracker()

    // Register config callbacks
    if (lifecycleConfig?.onMount) {
        lifecycleTracker.onMount(lifecycleConfig.onMount)
    }
    if (lifecycleConfig?.onUnmount) {
        lifecycleTracker.onUnmount(lifecycleConfig.onUnmount)
    }

    // Auto-clear draft on unmount if configured
    if (lifecycleConfig?.clearDraftOnUnmount) {
        lifecycleTracker.onUnmount((id) => {
            const store = getStore()
            store.set(draftAtomFamily(id), null)
        })
    }

    // ========================================================================
    // DERIVED ATOM FAMILIES
    // ========================================================================

    /**
     * Server data atom - extracts data from query, applies transform.
     * Also triggers lifecycle mount event on first access.
     */
    const serverDataAtomFamily = atomFamily((id: string) => {
        // Track mount event when atom is created
        lifecycleTracker.mount(id)

        return atom((get) => {
            const query = get(queryAtomFamily(id))
            const data = query.data ?? null
            if (data && transform) {
                return transform(data)
            }
            return data
        })
    }) as AtomFamily<T | null | undefined>

    /**
     * Merged data atom - combines server data with draft
     */
    const dataAtomFamily = atomFamily((id: string) =>
        atom((get) => {
            const serverData = get(serverDataAtomFamily(id)) ?? null
            const draft = get(draftAtomFamily(id))
            return merge(serverData, draft)
        }),
    ) as AtomFamily<T | null>

    /**
     * Dirty state atom - checks if draft differs from server
     */
    const isDirtyAtomFamily = atomFamily((id: string) =>
        atom((get) => {
            const serverData = get(serverDataAtomFamily(id)) ?? null
            const draft = get(draftAtomFamily(id))
            return isDirtyFn(serverData, draft)
        }),
    ) as AtomFamily<boolean>

    /**
     * New entity atom - checks if entity is not yet on server
     */
    const isNewAtomFamily = atomFamily((id: string) =>
        atom(() => isNewEntity(id)),
    ) as AtomFamily<boolean>

    // ========================================================================
    // NEW/DELETED TRACKING
    // ========================================================================

    /**
     * Base atom for tracking locally created entity IDs
     */
    const newIdsBaseAtom = atom<string[]>([])

    /**
     * Read-only atom for new IDs
     */
    const newIdsAtom: Atom<string[]> = atom((get) => get(newIdsBaseAtom))

    /**
     * Base atom for tracking soft-deleted entity IDs
     */
    const deletedIdsBaseAtom = atom<Set<string>>(new Set<string>())

    /**
     * Read-only atom for deleted IDs
     */
    const deletedIdsAtom: Atom<Set<string>> = atom((get) => get(deletedIdsBaseAtom))

    /**
     * Deleted state atom - checks if entity is marked for deletion
     */
    const isDeletedAtomFamily = atomFamily((id: string) =>
        atom((get) => get(deletedIdsBaseAtom).has(id)),
    ) as AtomFamily<boolean>

    // ========================================================================
    // ATOMS
    // ========================================================================

    const atoms: MoleculeAtoms<T, TDraft> = {
        data: dataAtomFamily,
        serverData: serverDataAtomFamily,
        draft: draftAtomFamily as AtomFamily<TDraft | null>,
        query: queryAtomFamily,
        isDirty: isDirtyAtomFamily,
        isNew: isNewAtomFamily,
        isDeleted: isDeletedAtomFamily,
        newIds: newIdsAtom,
        deletedIds: deletedIdsAtom,
    }

    // ========================================================================
    // REDUCERS
    // ========================================================================

    /**
     * Update reducer - merges changes into draft
     */
    const updateReducer = atom(null, (get, set, id: string, changes: TDraft) => {
        const currentDraft = get(draftAtomFamily(id))
        const newDraft = currentDraft ? {...currentDraft, ...changes} : changes
        set(draftAtomFamily(id), newDraft as TDraft)
    }) as Reducer<[id: string, changes: TDraft]>

    /**
     * Discard reducer - clears draft
     */
    const discardReducer = atom(null, (_get, set, id: string) => {
        set(draftAtomFamily(id), null)
    }) as Reducer<[id: string]>

    /**
     * Create reducer - creates a new local entity
     * Returns the generated ID via a side effect (stored in lastCreatedId)
     */
    let lastCreatedId: string | null = null
    const createReducer = atom(null, (_get, set, data?: TDraft) => {
        const id = generateLocalId()
        lastCreatedId = id

        // Add to new IDs tracking
        set(newIdsBaseAtom, (prev) => [...prev, id])

        // Initialize draft with provided data
        if (data) {
            set(draftAtomFamily(id), data)
        }

        // Trigger lifecycle mount
        lifecycleTracker.mount(id)
    }) as Reducer<[data?: TDraft]>

    /**
     * Delete reducer - marks entity for deletion (soft delete)
     */
    const deleteReducer = atom(null, (_get, set, id: string) => {
        set(deletedIdsBaseAtom, (prev) => new Set([...prev, id]))
    }) as Reducer<[id: string]>

    /**
     * Restore reducer - removes entity from deleted set
     */
    const restoreReducer = atom(null, (_get, set, id: string) => {
        set(deletedIdsBaseAtom, (prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
        })
    }) as Reducer<[id: string]>

    const reducers: MoleculeReducers<TDraft> = {
        update: updateReducer,
        discard: discardReducer,
        create: createReducer,
        delete: deleteReducer,
        restore: restoreReducer,
    }

    // ========================================================================
    // IMPERATIVE API
    // ========================================================================

    const getters: MoleculeGetters<T, TDraft> = {
        data: (id, options) => getStore(options).get(dataAtomFamily(id)),
        serverData: (id, options) => getStore(options).get(serverDataAtomFamily(id)),
        draft: (id, options) => getStore(options).get(draftAtomFamily(id)),
        query: (id, options) => getStore(options).get(queryAtomFamily(id)),
        isDirty: (id, options) => getStore(options).get(isDirtyAtomFamily(id)),
        isNew: (id, options) => getStore(options).get(isNewAtomFamily(id)),
    }

    const setters: MoleculeSetters<TDraft> = {
        update: (id, changes, options) => getStore(options).set(updateReducer, id, changes),
        discard: (id, options) => getStore(options).set(discardReducer, id),
        create: (data, options) => {
            getStore(options).set(createReducer, data)
            return lastCreatedId!
        },
        delete: (id, options) => getStore(options).set(deleteReducer, id),
        restore: (id, options) => getStore(options).set(restoreReducer, id),
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    const cleanup: MoleculeCleanup = {
        remove: (id: string) => {
            // Trigger unmount event before removing from cache
            lifecycleTracker.unmount(id)

            // Remove from all atom families
            serverDataAtomFamily.remove(id)
            dataAtomFamily.remove(id)
            isDirtyAtomFamily.remove(id)
            isNewAtomFamily.remove(id)
            // Note: queryAtomFamily and draftAtomFamily should be managed separately
            // as they may have their own cleanup logic
        },
        setShouldRemove: (fn: (createdAt: number, id: string) => boolean) => {
            // Wrap the provided function to also trigger unmount
            const wrappedFn = (createdAt: number, id: string) => {
                const shouldRemove = fn(createdAt, id)
                if (shouldRemove) {
                    lifecycleTracker.unmount(id)
                }
                return shouldRemove
            }
            serverDataAtomFamily.setShouldRemove(wrappedFn)
            dataAtomFamily.setShouldRemove(wrappedFn)
            isDirtyAtomFamily.setShouldRemove(wrappedFn)
            isNewAtomFamily.setShouldRemove(wrappedFn)
        },
        getIds: () => {
            // Return IDs from the data atom family
            return Array.from(dataAtomFamily.getParams())
        },
    }

    // ========================================================================
    // LIFECYCLE API
    // ========================================================================

    const lifecycle: MoleculeLifecycle = {
        onMount: lifecycleTracker.onMount,
        onUnmount: lifecycleTracker.onUnmount,
        isActive: lifecycleTracker.isActive,
        getActiveCount: lifecycleTracker.getActiveCount,
    }

    // ========================================================================
    // REACT HOOK
    // ========================================================================

    /**
     * React hook that combines state + dispatch for a single entity
     */
    function useController(id: string): UseControllerResult<T, TDraft> {
        const data = useAtomValue(dataAtomFamily(id))
        const serverData = useAtomValue(serverDataAtomFamily(id))
        const query = useAtomValue(queryAtomFamily(id)) as QueryState<T>
        const isDirty = useAtomValue(isDirtyAtomFamily(id))
        const isNew = useAtomValue(isNewAtomFamily(id))
        const isDeleted = useAtomValue(isDeletedAtomFamily(id))

        const setUpdate = useSetAtom(updateReducer)
        const setDiscard = useSetAtom(discardReducer)
        const setDelete = useSetAtom(deleteReducer)
        const setRestore = useSetAtom(restoreReducer)

        const state: MoleculeState<T> = {
            data,
            serverData: serverData ?? null,
            isPending: query.isPending,
            isError: query.isError,
            error: query.error,
            isDirty,
            isNew,
            isDeleted,
        }

        const dispatch: MoleculeDispatch<TDraft> = {
            update: (changes: TDraft) => setUpdate(id, changes),
            discard: () => setDiscard(id),
            delete: () => setDelete(id),
            restore: () => setRestore(id),
        }

        return [state, dispatch]
    }

    // ========================================================================
    // RETURN MOLECULE
    // ========================================================================

    return {
        name,
        atoms,
        reducers,
        get: getters,
        set: setters,
        useController,
        cleanup,
        lifecycle,
    }
}
