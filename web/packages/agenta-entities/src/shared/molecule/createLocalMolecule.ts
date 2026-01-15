/**
 * createLocalMolecule Factory
 *
 * Creates a molecule for client-only entities that exist purely in local state.
 * Uses the same API as server molecules but without server-side persistence.
 *
 * ## Use Cases
 *
 * - Creating entities before saving to server (drafts, wizards)
 * - Temporary entities in multi-step flows
 * - Local-only entities that never sync to server
 * - Testing and prototyping
 *
 * ## Key Differences from Server Molecules
 *
 * - No query/fetch - data is set directly
 * - `serverData` is always `null`
 * - `isNew` is always `true`
 * - `isDirty` reflects if data exists
 * - Entities are created with `local-` prefixed IDs
 *
 * @example
 * ```typescript
 * // Create a local testcase molecule for draft testcases
 * const localTestcaseMolecule = createLocalMolecule<Testcase>({
 *   name: 'localTestcase',
 *   createDefault: () => ({ data: {} }),
 *   validate: (tc) => testcaseSchema.parse(tc),
 * })
 *
 * // Usage
 * const id = localTestcaseMolecule.set.create({ data: { country: 'USA' } })
 * const testcase = localTestcaseMolecule.get.data(id)
 * localTestcaseMolecule.set.update(id, { data: { country: 'UK' } })
 * localTestcaseMolecule.set.delete(id)
 *
 * // React component
 * function DraftTestcase({ id }: { id: string }) {
 *   const [state, dispatch] = localTestcaseMolecule.useController(id)
 *
 *   return (
 *     <Input
 *       value={state.data?.country || ''}
 *       onChange={(e) => dispatch.update({ data: { country: e.target.value } })}
 *     />
 *   )
 * }
 * ```
 */

import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import type {
    AtomFamily,
    CreateLocalMoleculeConfig,
    LocalMolecule,
    LocalQueryState,
    MoleculeCleanup,
    MoleculeDispatch,
    MoleculeState,
    Reducer,
    StoreOptions,
    UseControllerResult,
} from "./types"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

function defaultGenerateId(): string {
    return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Creates a local molecule for client-only entities.
 */
export function createLocalMolecule<T>(config: CreateLocalMoleculeConfig<T>): LocalMolecule<T> {
    const {name, generateId = defaultGenerateId, createDefault, validate, transform} = config

    // ========================================================================
    // CORE STATE
    // ========================================================================

    /**
     * Central store for all local entity data
     * Map of ID -> data
     */
    const localDataAtom = atom<Map<string, T>>(new Map())

    /**
     * Derived atom for all IDs
     */
    const allIdsAtom = atom((get) => {
        const dataMap = get(localDataAtom)
        return Array.from(dataMap.keys())
    })

    // ========================================================================
    // ATOM FAMILIES
    // ========================================================================

    /**
     * Data atom family - returns data for specific ID
     */
    const dataAtomFamily = atomFamily((id: string) =>
        atom((get) => {
            const dataMap = get(localDataAtom)
            return dataMap.get(id) ?? null
        }),
    ) as AtomFamily<T | null>

    /**
     * Server data - always null for local molecules
     */
    const serverDataAtomFamily = atomFamily((_id: string) => atom(() => null)) as AtomFamily<null>

    /**
     * Draft - same as data for local molecules
     */
    const draftAtomFamily = dataAtomFamily as AtomFamily<T | null>

    /**
     * Query state - always successful for local molecules
     */
    const queryAtomFamily = atomFamily((id: string) =>
        atom((get): LocalQueryState<T> => {
            const data = get(dataAtomFamily(id))
            return {
                data: data ?? undefined,
                isPending: false,
                isError: false,
                error: null,
                isFetching: false,
                isSuccess: true,
            }
        }),
    ) as AtomFamily<LocalQueryState<T>>

    /**
     * isDirty - true if data exists
     */
    const isDirtyAtomFamily = atomFamily((id: string) =>
        atom((get) => {
            const data = get(dataAtomFamily(id))
            return data !== null
        }),
    ) as AtomFamily<boolean>

    /**
     * isNew - always true for local molecules
     */
    const isNewAtomFamily = atomFamily((_id: string) => atom(() => true)) as AtomFamily<boolean>

    // ========================================================================
    // ATOMS INTERFACE
    // ========================================================================

    const atoms = {
        data: dataAtomFamily,
        serverData: serverDataAtomFamily,
        draft: draftAtomFamily,
        query: queryAtomFamily,
        isDirty: isDirtyAtomFamily,
        isNew: isNewAtomFamily,
        allIds: allIdsAtom,
    }

    // ========================================================================
    // REDUCERS
    // ========================================================================

    /**
     * Create a new local entity
     */
    const createReducer = atom(null, (get, set, data?: Partial<T>) => {
        const id = generateId()
        const defaultData = createDefault?.() ?? ({} as T)
        let entityData = {...defaultData, ...data} as T

        if (validate) {
            entityData = validate(entityData)
        }
        if (transform) {
            entityData = transform(entityData)
        }

        const dataMap = new Map(get(localDataAtom))
        dataMap.set(id, entityData)
        set(localDataAtom, dataMap)

        return id
    }) as unknown as Reducer<[data?: Partial<T>]>

    /**
     * Create with specific ID
     */
    const createWithIdReducer = atom(null, (get, set, id: string, data: T) => {
        let entityData = data

        if (validate) {
            entityData = validate(entityData)
        }
        if (transform) {
            entityData = transform(entityData)
        }

        const dataMap = new Map(get(localDataAtom))
        dataMap.set(id, entityData)
        set(localDataAtom, dataMap)
    }) as Reducer<[id: string, data: T]>

    /**
     * Update entity data
     */
    const updateReducer = atom(null, (get, set, id: string, changes: Partial<T>) => {
        const dataMap = new Map(get(localDataAtom))
        const current = dataMap.get(id)

        if (!current) {
            console.warn(`[${name}] Cannot update non-existent entity: ${id}`)
            return
        }

        let updated = {...current, ...changes} as T

        if (validate) {
            updated = validate(updated)
        }
        if (transform) {
            updated = transform(updated)
        }

        dataMap.set(id, updated)
        set(localDataAtom, dataMap)
    }) as Reducer<[id: string, changes: Partial<T>]>

    /**
     * Delete entity
     */
    const deleteReducer = atom(null, (get, set, id: string) => {
        const dataMap = new Map(get(localDataAtom))
        dataMap.delete(id)
        set(localDataAtom, dataMap)
    }) as Reducer<[id: string]>

    /**
     * Discard (alias for delete)
     */
    const discardReducer = deleteReducer

    /**
     * Clear all entities
     */
    const clearReducer = atom(null, (_get, set) => {
        set(localDataAtom, new Map())
    }) as Reducer<[]>

    const reducers = {
        create: createReducer,
        createWithId: createWithIdReducer,
        update: updateReducer,
        delete: deleteReducer,
        discard: discardReducer,
        clear: clearReducer,
    }

    // ========================================================================
    // IMPERATIVE API
    // ========================================================================

    const getters = {
        data: (id: string, options?: StoreOptions) => getStore(options).get(dataAtomFamily(id)),
        allIds: (options?: StoreOptions) => getStore(options).get(allIdsAtom),
        all: (options?: StoreOptions) => {
            const dataMap = getStore(options).get(localDataAtom)
            return Array.from(dataMap.values())
        },
    }

    const setters = {
        create: (data?: Partial<T>, options?: StoreOptions): string => {
            // We need to return the ID, so we implement this differently
            const store = getStore(options)
            const id = generateId()
            const defaultData = createDefault?.() ?? ({} as T)
            let entityData = {...defaultData, ...data} as T

            if (validate) {
                entityData = validate(entityData)
            }
            if (transform) {
                entityData = transform(entityData)
            }

            const dataMap = new Map(store.get(localDataAtom))
            dataMap.set(id, entityData)
            store.set(localDataAtom, dataMap)

            return id
        },
        createWithId: (id: string, data: T, options?: StoreOptions) =>
            getStore(options).set(createWithIdReducer, id, data),
        update: (id: string, changes: Partial<T>, options?: StoreOptions) =>
            getStore(options).set(updateReducer, id, changes),
        delete: (id: string, options?: StoreOptions) => getStore(options).set(deleteReducer, id),
        clear: (options?: StoreOptions) => getStore(options).set(clearReducer),
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    const cleanup: MoleculeCleanup = {
        remove: (id: string) => {
            const store = getDefaultStore()
            const dataMap = new Map(store.get(localDataAtom))
            dataMap.delete(id)
            store.set(localDataAtom, dataMap)

            // Remove from atom families
            dataAtomFamily.remove(id)
            serverDataAtomFamily.remove(id)
            queryAtomFamily.remove(id)
            isDirtyAtomFamily.remove(id)
            isNewAtomFamily.remove(id)
        },
        setShouldRemove: (fn: (createdAt: number, id: string) => boolean) => {
            dataAtomFamily.setShouldRemove(fn)
            serverDataAtomFamily.setShouldRemove(fn)
            queryAtomFamily.setShouldRemove(fn)
            isDirtyAtomFamily.setShouldRemove(fn)
            isNewAtomFamily.setShouldRemove(fn)
        },
        getIds: () => {
            return getDefaultStore().get(allIdsAtom)
        },
    }

    // ========================================================================
    // REACT HOOK
    // ========================================================================

    function useController(id: string): UseControllerResult<T, Partial<T>> {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const {useAtomValue, useSetAtom} = require("jotai")

        const data = useAtomValue(dataAtomFamily(id))
        const isDirty = useAtomValue(isDirtyAtomFamily(id))
        const isNew = useAtomValue(isNewAtomFamily(id))

        const setUpdate = useSetAtom(updateReducer)
        const setDelete = useSetAtom(deleteReducer)

        const state: MoleculeState<T> = {
            data,
            serverData: null,
            isPending: false,
            isError: false,
            error: null,
            isDirty,
            isNew,
            isDeleted: false, // Local entities don't have soft-delete
        }

        const dispatch: MoleculeDispatch<Partial<T>> = {
            update: (changes: Partial<T>) => setUpdate(id, changes),
            discard: () => setDelete(id),
            delete: () => setDelete(id), // For local entities, delete is immediate
            restore: () => {}, // No-op for local entities (can't restore deleted)
        }

        return [state, dispatch]
    }

    // ========================================================================
    // RETURN
    // ========================================================================

    return {
        name,
        source: "local",
        atoms,
        reducers,
        get: getters,
        set: setters,
        useController,
        cleanup,
        generateId,
    }
}
