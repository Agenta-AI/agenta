/**
 * Stub Molecule Factory
 *
 * Creates placeholder molecule implementations for optional entities.
 * Useful for:
 * - Feature-flagged entities (e.g., evaluators in OSS vs EE)
 * - Testing/mocking scenarios
 * - Graceful degradation when entity modules are not available
 *
 * @example
 * ```typescript
 * // Create a stub for an optional entity
 * export const evaluatorRevisionMolecule = createStubMolecule({
 *     name: "evaluatorRevision",
 *     extraSelectors: {
 *         presets: () => atom<unknown[]>(() => []),
 *     },
 *     extraActions: {
 *         applyPreset: atom(null, () => {
 *             console.warn("applyPreset is not implemented")
 *         }),
 *     },
 * })
 * ```
 */

import {atom, type Atom, type WritableAtom} from "jotai"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Standard query state returned by entity queries
 */
export interface StubQueryState<T = unknown> {
    data: T | null
    isPending: boolean
    isError: boolean
    error: unknown
}

/**
 * Base selectors included in every stub molecule
 */
export interface StubMoleculeSelectors {
    /** Get entity data by ID - returns null */
    data: (id: string) => Atom<unknown | null>
    /** Get query state by ID - returns idle state */
    query: (id: string) => Atom<StubQueryState>
    /** Check if entity has unsaved changes - returns false */
    isDirty: (id: string) => Atom<boolean>
}

/**
 * Configuration for creating a stub molecule
 */

export interface CreateStubMoleculeConfig<
    ExtraSelectors extends Record<string, (id: string) => Atom<unknown>> = Record<string, never>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Jotai needs flexible types
    ExtraActions extends Record<string, WritableAtom<any, any[], any>> = Record<string, never>,
> {
    /** Name of the entity (for logging/debugging) */
    name: string
    /** Additional selectors beyond the base ones */
    extraSelectors?: ExtraSelectors
    /** Actions for the molecule */
    extraActions?: ExtraActions
    /** Custom warning message when stub is used */
    warningMessage?: string
    /** Whether to suppress console warnings */
    silent?: boolean
}

/**
 * Return type of createStubMolecule
 */

export interface StubMolecule<
    ExtraSelectors extends Record<string, (id: string) => Atom<unknown>> = Record<string, never>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Jotai needs flexible types
    ExtraActions extends Record<string, WritableAtom<any, any[], any>> = Record<string, never>,
> {
    selectors: StubMoleculeSelectors & ExtraSelectors
    actions: ExtraActions
    /** Indicates this is a stub implementation */
    __isStub: true
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Default query state for stubs
 */
const defaultQueryState: StubQueryState = {
    data: null,
    isPending: false,
    isError: false,
    error: null,
}

/**
 * Create a stub molecule for an optional entity
 *
 * Returns a molecule-compatible object with base selectors that return
 * empty/null values. Useful for graceful degradation when an entity
 * implementation is not available.
 *
 * @param config - Configuration for the stub
 * @returns A stub molecule with selectors and actions
 *
 * @example
 * ```typescript
 * // Simple stub
 * const myEntityMolecule = createStubMolecule({ name: "myEntity" })
 *
 * // With extra selectors and actions
 * const evaluatorMolecule = createStubMolecule({
 *     name: "evaluatorRevision",
 *     extraSelectors: {
 *         presets: (_id) => atom<SettingsPreset[]>(() => []),
 *     },
 *     extraActions: {
 *         applyPreset: atom(null, (_get, _set, _evaluatorId: string, _presetId: string) => {}),
 *     },
 * })
 * ```
 */

export function createStubMolecule<
    ExtraSelectors extends Record<string, (id: string) => Atom<unknown>> = Record<string, never>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Jotai needs flexible types
    ExtraActions extends Record<string, WritableAtom<any, any[], any>> = Record<string, never>,
>(
    config: CreateStubMoleculeConfig<ExtraSelectors, ExtraActions>,
): StubMolecule<ExtraSelectors, ExtraActions> {
    const {
        name: _name,
        extraSelectors = {} as ExtraSelectors,
        extraActions = {} as ExtraActions,
    } = config

    // Base selectors that every molecule should have
    const baseSelectors: StubMoleculeSelectors = {
        data: (_id: string) =>
            atom<unknown | null>(() => {
                return null
            }),

        query: (_id: string) =>
            atom<StubQueryState>(() => {
                return defaultQueryState
            }),

        isDirty: (_id: string) =>
            atom<boolean>(() => {
                return false
            }),
    }

    return {
        selectors: {
            ...baseSelectors,
            ...extraSelectors,
        } as StubMoleculeSelectors & ExtraSelectors,
        actions: extraActions,
        __isStub: true,
    }
}

/**
 * Check if a molecule is a stub implementation
 */
export function isStubMolecule(molecule: unknown): boolean {
    return (
        typeof molecule === "object" &&
        molecule !== null &&
        "__isStub" in molecule &&
        (molecule as {__isStub: boolean}).__isStub === true
    )
}
