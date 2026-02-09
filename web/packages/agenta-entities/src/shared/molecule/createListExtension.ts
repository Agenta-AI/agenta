/**
 * createListExtension Factory
 *
 * Creates a standard list extension for molecules that need parent-child relationships.
 * Provides reactive data access for UI components.
 *
 * @example
 * ```typescript
 * // Create a list extension for revisions
 * const revisionsListExtension = createListExtension<RevisionListItem>({
 *   name: 'revisionsList',
 *   queryAtomFamily: revisionsListQueryAtomFamily,
 *   enableAtom: enableRevisionsListQueryAtom,
 * })
 *
 * // Use in extendMolecule
 * const testsetMolecule = extendMolecule(baseMolecule, {
 *   ...revisionsListExtension,
 * })
 *
 * // In components - reactive data access
 * const revisions = useAtomValue(testsetMolecule.atoms.revisionsList.data(parentId))
 *
 * // Request data (triggers fetch)
 * const request = useSetAtom(testsetMolecule.reducers.revisionsList.request)
 * request({parentId, projectId})
 *
 * // Imperative access
 * const data = testsetMolecule.get.revisionsList(parentId)
 * ```
 */

import {atom} from "jotai"
import type {Atom, WritableAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import type {QueryState, StoreOptions} from "./types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for creating a list extension
 */
export interface CreateListExtensionConfig<TItem, TParams = {parentId: string; projectId: string}> {
    /** Name for the list (used as key in atoms/reducers/getters) */
    name: string
    /** Query atom family that fetches the list data */
    queryAtomFamily: (parentId: string) => Atom<QueryState<TItem[]>>
    /** Action atom to enable/request the list query */
    enableAtom: WritableAtom<null, [TParams], void>
}

/**
 * Result of createListExtension - can be spread into extendMolecule config
 */
export interface ListExtensionAtoms<TItem> {
    /** Query atom - returns full QueryState<TItem[]> */
    query: (parentId: string) => Atom<QueryState<TItem[]>>
    /** Data atom - returns just TItem[] reactively */
    data: (parentId: string) => Atom<TItem[]>
}

export interface ListExtensionReducers<TParams> {
    /** Request atom to trigger fetching */
    request: WritableAtom<null, [TParams], void>
}

export interface ListExtension<TItem, TParams = {parentId: string; projectId: string}> {
    atoms: Record<string, ListExtensionAtoms<TItem>>
    reducers: Record<string, ListExtensionReducers<TParams>>
    get: Record<string, (parentId: string, options?: StoreOptions) => TItem[]>
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Get the store to use for imperative operations
 */
function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

/**
 * Creates a standard list extension for molecules.
 *
 * Provides:
 * - `atoms.[name].query(parentId)` - Full query state (data, isPending, isError)
 * - `atoms.[name].data(parentId)` - Just the data array, reactive
 * - `reducers.[name].request` - Action to trigger fetching
 * - `get.[name](parentId)` - Imperative data access
 */
export function createListExtension<TItem, TParams = {parentId: string; projectId: string}>(
    config: CreateListExtensionConfig<TItem, TParams>,
): ListExtension<TItem, TParams> {
    const {name, queryAtomFamily, enableAtom} = config

    // Create a derived atom family that returns just the data array
    const dataAtomFamily = atomFamily((parentId: string) =>
        atom((get): TItem[] => {
            const query = get(queryAtomFamily(parentId))
            return query.data ?? []
        }),
    )

    return {
        atoms: {
            [name]: {
                query: queryAtomFamily,
                data: dataAtomFamily,
            },
        },
        reducers: {
            [name]: {
                request: enableAtom,
            },
        },
        get: {
            [name]: (parentId: string, options?: StoreOptions): TItem[] => {
                const query = getStore(options).get(queryAtomFamily(parentId))
                return query.data ?? []
            },
        },
    }
}

/**
 * Type helper to extract the list extension type
 */
export type InferListExtension<TConfig extends CreateListExtensionConfig<unknown, unknown>> =
    TConfig extends CreateListExtensionConfig<infer TItem, infer TParams>
        ? ListExtension<TItem, TParams>
        : never
