/**
 * Null-Safe Atom Utilities
 *
 * Provides factory functions for creating null-safe atom selectors.
 * These utilities eliminate duplicated patterns across molecules for handling
 * optional/nullable entity IDs.
 *
 * @example
 * ```typescript
 * import {
 *   createNullQueryResultAtom,
 *   createNullDataAtom,
 *   createNullSafeQuerySelector,
 *   createNullSafeDataSelector,
 * } from '@agenta/entities/shared'
 *
 * // Create null-safe atoms for a molecule
 * const nullQueryResult = createNullQueryResultAtom<MyEntity>()
 * const nullData = createNullDataAtom<MyEntity>()
 *
 * // Create selectors
 * const queryOptional = createNullSafeQuerySelector(
 *   myQueryAtomFamily,
 *   nullQueryResult
 * )
 * const dataOptional = createNullSafeDataSelector(
 *   myDataAtomFamily,
 *   nullData
 * )
 *
 * // Use in components
 * const query = useAtomValue(queryOptional(maybeId))
 * const data = useAtomValue(dataOptional(maybeId))
 * ```
 */

import {atom} from "jotai"
import type {Atom} from "jotai"

import type {QueryState} from "../molecule/types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Query result shape for null-safe atoms.
 * Matches the standard QueryState interface.
 */
export interface NullQueryResult<T> {
    data: T | null
    isPending: boolean
    isError: boolean
    error: Error | null
}

/**
 * Type for atom family functions that take an ID and return an atom.
 */
export type AtomFamilyFn<T> = (id: string) => Atom<T>

// ============================================================================
// NULL ATOM FACTORIES
// ============================================================================

/**
 * Creates a null-safe query result atom.
 *
 * Returns a static atom that provides a "null" query state:
 * - `data: null`
 * - `isPending: false`
 * - `isError: false`
 * - `error: null`
 *
 * Use this when the entity ID is null/undefined to prevent
 * unnecessary network requests.
 *
 * @returns A static atom with null query result
 *
 * @example
 * ```typescript
 * const nullQueryResult = createNullQueryResultAtom<Revision>()
 * // Returns atom with: { data: null, isPending: false, isError: false, error: null }
 * ```
 */
export function createNullQueryResultAtom<T>(): Atom<QueryState<T>> {
    return atom<QueryState<T>>(() => ({
        data: null,
        isPending: false,
        isError: false,
        error: null,
    }))
}

/**
 * Creates a null-safe data atom.
 *
 * Returns a static atom that always returns `null`.
 * Use this when the entity ID is null/undefined.
 *
 * @returns A static atom that returns null
 *
 * @example
 * ```typescript
 * const nullData = createNullDataAtom<Revision>()
 * // Returns atom with value: null
 * ```
 */
export function createNullDataAtom<T>(): Atom<T | null> {
    return atom<T | null>(() => null)
}

// ============================================================================
// NULL-SAFE SELECTOR FACTORIES
// ============================================================================

/**
 * Creates a null-safe query selector function.
 *
 * Returns a function that:
 * - Returns the query atom from the family when ID is provided
 * - Returns the null query atom when ID is null/undefined
 *
 * This eliminates the need to manually check for null IDs in components.
 *
 * @param atomFamily - The query atom family function
 * @param nullAtom - The null query result atom
 * @returns A selector function that handles optional IDs
 *
 * @example
 * ```typescript
 * const nullQueryResult = createNullQueryResultAtom<Revision>()
 * const queryOptional = createNullSafeQuerySelector(
 *   revisionQueryAtomFamily,
 *   nullQueryResult
 * )
 *
 * // In component
 * const query = useAtomValue(queryOptional(maybeRevisionId))
 * // No need to check for null - returns { data: null, isPending: false, ... }
 * ```
 */
export function createNullSafeQuerySelector<T>(
    atomFamily: AtomFamilyFn<QueryState<T>>,
    nullAtom: Atom<QueryState<T>>,
): (id: string | null | undefined) => Atom<QueryState<T>> {
    return (id: string | null | undefined) => (id ? atomFamily(id) : nullAtom)
}

/**
 * Creates a null-safe data selector function.
 *
 * Returns a function that:
 * - Returns the data atom from the family when ID is provided
 * - Returns the null data atom when ID is null/undefined
 *
 * @param atomFamily - The data atom family function
 * @param nullAtom - The null data atom
 * @returns A selector function that handles optional IDs
 *
 * @example
 * ```typescript
 * const nullData = createNullDataAtom<Revision>()
 * const dataOptional = createNullSafeDataSelector(
 *   revisionDataAtomFamily,
 *   nullData
 * )
 *
 * // In component
 * const data = useAtomValue(dataOptional(maybeRevisionId))
 * // Returns null instead of throwing when ID is undefined
 * ```
 */
export function createNullSafeDataSelector<T>(
    atomFamily: AtomFamilyFn<T | null>,
    nullAtom: Atom<T | null>,
): (id: string | null | undefined) => Atom<T | null> {
    return (id: string | null | undefined) => (id ? atomFamily(id) : nullAtom)
}

// ============================================================================
// CONVENIENCE FACTORY
// ============================================================================

/**
 * Configuration for creating a complete set of null-safe selectors.
 */
export interface CreateNullSafeSelectorsConfig<T> {
    /** The query atom family function */
    queryAtomFamily: AtomFamilyFn<QueryState<T>>
    /** The data atom family function */
    dataAtomFamily: AtomFamilyFn<T | null>
}

/**
 * Result of creating null-safe selectors.
 */
export interface NullSafeSelectors<T> {
    /** Null query result atom (for direct use) */
    nullQueryAtom: Atom<QueryState<T>>
    /** Null data atom (for direct use) */
    nullDataAtom: Atom<T | null>
    /** Query selector that handles optional IDs */
    queryOptional: (id: string | null | undefined) => Atom<QueryState<T>>
    /** Data selector that handles optional IDs */
    dataOptional: (id: string | null | undefined) => Atom<T | null>
}

/**
 * Creates a complete set of null-safe selectors for an entity.
 *
 * This is a convenience factory that creates all null-safe atoms and selectors
 * in one call, reducing boilerplate.
 *
 * @param config - Configuration with query and data atom families
 * @returns Object with null atoms and selector functions
 *
 * @example
 * ```typescript
 * const {
 *   nullQueryAtom,
 *   nullDataAtom,
 *   queryOptional,
 *   dataOptional,
 * } = createNullSafeSelectors({
 *   queryAtomFamily: revisionQueryAtomFamily,
 *   dataAtomFamily: revisionDataAtomFamily,
 * })
 *
 * // Add to molecule
 * export const revisionMolecule = {
 *   ...baseMolecule,
 *   queryOptional,
 *   dataOptional,
 * }
 * ```
 */
export function createNullSafeSelectors<T>(
    config: CreateNullSafeSelectorsConfig<T>,
): NullSafeSelectors<T> {
    const nullQueryAtom = createNullQueryResultAtom<T>()
    const nullDataAtom = createNullDataAtom<T>()

    return {
        nullQueryAtom,
        nullDataAtom,
        queryOptional: createNullSafeQuerySelector(config.queryAtomFamily, nullQueryAtom),
        dataOptional: createNullSafeDataSelector(config.dataAtomFamily, nullDataAtom),
    }
}
