/**
 * Controller Atom Family Factory
 *
 * Creates a controller atom family that provides state + dispatch pattern
 * for EntityDrillInView and similar components that need combined read/write access.
 *
 * This extracts the common controller pattern used across trace, testcase, and other entities.
 *
 * @example
 * ```typescript
 * // Create controller for a molecule
 * const controller = createControllerAtomFamily({
 *     dataAtom: molecule.atoms.data,
 *     isDirtyAtom: molecule.atoms.isDirty,
 *     queryAtom: molecule.atoms.query,
 *     updateReducer: molecule.reducers.update,
 *     discardReducer: molecule.reducers.discard,
 * })
 *
 * // Use in components
 * const [state, dispatch] = useAtom(controller(entityId))
 * dispatch({ type: 'update', changes: { name: 'New Name' } })
 * dispatch({ type: 'setAtPath', path: ['nested', 'value'], value: 123 })
 * ```
 */

import {atom, type WritableAtom} from "jotai"
import {atomFamily} from "jotai-family"

import type {AtomFamily, QueryState, Reducer} from "./types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Path through nested data (array of string keys or numeric indices)
 */
export type DataPath = (string | number)[]

/**
 * Controller state - what the controller atom returns when read
 */
export interface ControllerState<T> {
    /** Merged entity data (server + draft) */
    data: T | null
    /** Whether entity has unsaved local changes */
    isDirty: boolean
    /** Whether initial fetch is in progress */
    isPending: boolean
    /** Whether fetch failed */
    isError: boolean
    /** Error if fetch failed */
    error: Error | null
}

/**
 * Actions that can be dispatched to the controller
 */
export type ControllerAction<TDraft> =
    | {type: "update"; changes: TDraft}
    | {type: "discard"}
    | {type: "setAtPath"; path: DataPath; value: unknown}

/**
 * DrillIn configuration for path-based updates
 *
 * If provided, enables the "setAtPath" action which converts
 * a path-based update into the appropriate draft changes.
 */
export interface DrillInConfig<T, TDraft> {
    /**
     * Convert a path-based change into draft changes.
     *
     * For entities where only part of the data is draftable (like trace spans
     * where only attributes are draftable), this function handles the conversion.
     *
     * @param data - Current entity data
     * @param path - Path to the value being changed
     * @param value - New value
     * @returns Draft changes to apply, or null if invalid path
     *
     * @example
     * ```typescript
     * // For trace spans where only attributes are draftable:
     * getChangesFromPath: (span, path, value) => {
     *     if (path[0] !== 'attributes') return null
     *     const updated = setValueAtPath(span, path, value)
     *     return updated.attributes
     * }
     *
     * // For entities where entire data is draftable:
     * getChangesFromPath: (data, path, value) => {
     *     const updated = setValueAtPath(data, path, value)
     *     return { [path[0]]: updated[path[0]] }
     * }
     * ```
     */
    getChangesFromPath: (data: T | null, path: DataPath, value: unknown) => TDraft | null
}

/**
 * Configuration for createControllerAtomFamily
 */
export interface CreateControllerConfig<T, TDraft> {
    /**
     * Atom family that returns merged entity data (server + draft)
     */
    dataAtom: AtomFamily<T | null>

    /**
     * Atom family that returns dirty state
     */
    isDirtyAtom: AtomFamily<boolean>

    /**
     * Atom family that returns query state (isPending, isError, error)
     */
    queryAtom: AtomFamily<QueryState<T>>

    /**
     * Reducer for applying updates to draft
     * Signature: (id: string, changes: TDraft) => void
     */
    updateReducer: Reducer<[id: string, changes: TDraft]>

    /**
     * Reducer for discarding draft changes
     * Signature: (id: string) => void
     */
    discardReducer: Reducer<[id: string]>

    /**
     * Optional drillIn config for path-based updates.
     * If provided, enables the "setAtPath" action.
     */
    drillIn?: DrillInConfig<T, TDraft>
}

/**
 * Controller atom family type
 */
export type ControllerAtomFamily<T, TDraft> = (
    id: string,
) => WritableAtom<ControllerState<T>, [ControllerAction<TDraft>], void>

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Creates a controller atom family for an entity.
 *
 * The controller provides a unified read/write interface:
 * - Read: Returns { data, isDirty, isPending, isError, error }
 * - Write: Accepts actions { type: 'update'|'discard'|'setAtPath', ... }
 *
 * This pattern is required by EntityDrillInView and provides a convenient
 * API for components that need both state and dispatch in one place.
 *
 * @example
 * ```typescript
 * // Create from molecule atoms/reducers
 * const controllerAtomFamily = createControllerAtomFamily({
 *     dataAtom: myMolecule.atoms.data,
 *     isDirtyAtom: myMolecule.atoms.isDirty,
 *     queryAtom: myMolecule.atoms.query,
 *     updateReducer: myMolecule.reducers.update,
 *     discardReducer: myMolecule.reducers.discard,
 *     drillIn: {
 *         getChangesFromPath: (data, path, value) => {
 *             // Convert path update to draft changes
 *             const updated = setValueAtPath(data, path, value)
 *             return { [path[0]]: updated[path[0]] }
 *         }
 *     }
 * })
 *
 * // Use in component
 * const [state, dispatch] = useAtom(controllerAtomFamily(entityId))
 *
 * // Update via changes object
 * dispatch({ type: 'update', changes: { name: 'New Name' } })
 *
 * // Update via path (requires drillIn config)
 * dispatch({ type: 'setAtPath', path: ['nested', 'value'], value: 123 })
 *
 * // Discard changes
 * dispatch({ type: 'discard' })
 * ```
 */
export function createControllerAtomFamily<T, TDraft = Partial<T>>(
    config: CreateControllerConfig<T, TDraft>,
): ControllerAtomFamily<T, TDraft> {
    const {dataAtom, isDirtyAtom, queryAtom, updateReducer, discardReducer, drillIn} = config

    return atomFamily((entityId: string) =>
        atom(
            // Read function - compute controller state
            (get): ControllerState<T> => {
                const data = get(dataAtom(entityId))
                const isDirty = get(isDirtyAtom(entityId))
                const query = get(queryAtom(entityId))

                return {
                    data,
                    isDirty,
                    isPending: query.isPending,
                    isError: query.isError,
                    error: query.error,
                }
            },

            // Write function - dispatch actions
            (get, set, action: ControllerAction<TDraft>) => {
                switch (action.type) {
                    case "update":
                        set(updateReducer, entityId, action.changes)
                        break

                    case "discard":
                        set(discardReducer, entityId)
                        break

                    case "setAtPath":
                        if (drillIn) {
                            const data = get(dataAtom(entityId))
                            const changes = drillIn.getChangesFromPath(
                                data,
                                action.path,
                                action.value,
                            )
                            if (changes) {
                                set(updateReducer, entityId, changes)
                            }
                        } else {
                            console.warn(
                                "[Controller] setAtPath action requires drillIn config to be provided",
                            )
                        }
                        break
                }
            },
        ),
    ) as ControllerAtomFamily<T, TDraft>
}

// ============================================================================
// HELPER FOR CREATING SELECTORS ALIAS
// ============================================================================

/**
 * Creates a selectors object that aliases molecule atoms.
 *
 * EntityDrillInView expects `entity.selectors.data(id)` etc.
 * This helper creates that alias from molecule atoms.
 *
 * @example
 * ```typescript
 * const selectors = createSelectorsAlias({
 *     data: molecule.atoms.data,
 *     isDirty: molecule.atoms.isDirty,
 *     query: molecule.atoms.query,
 * })
 *
 * // Now you can use:
 * selectors.data(id)     // Same as molecule.atoms.data(id)
 * selectors.isDirty(id)  // Same as molecule.atoms.isDirty(id)
 * selectors.query(id)    // Same as molecule.atoms.query(id)
 * ```
 */
export function createSelectorsAlias<T, _TDraft = Partial<T>>(atoms: {
    data: AtomFamily<T | null>
    isDirty: AtomFamily<boolean>
    query: AtomFamily<QueryState<T>>
    [key: string]: AtomFamily<unknown>
}): {
    data: AtomFamily<T | null>
    isDirty: AtomFamily<boolean>
    query: AtomFamily<QueryState<T>>
    [key: string]: AtomFamily<unknown>
} {
    return atoms
}

// ============================================================================
// WITH CONTROLLER WRAPPER
// ============================================================================

/**
 * Molecule with controller capability
 * Combines the base molecule with controller and selectors for EntityDrillInView compatibility
 */
export type MoleculeWithController<T, TDraft, TMolecule> = TMolecule & {
    /** Controller atom family for EntityDrillInView */
    controller: ControllerAtomFamily<T, TDraft>

    /** Selectors alias for EntityDrillInView compatibility */
    selectors: {
        data: AtomFamily<T | null>
        isDirty: AtomFamily<boolean>
        query: AtomFamily<QueryState<T>>
    }
}

/**
 * Configuration for withController wrapper
 */
export interface WithControllerConfig<T, TDraft> {
    /**
     * Optional drillIn config for path-based updates.
     * If provided, enables the "setAtPath" action.
     */
    drillIn?: DrillInConfig<T, TDraft>
}

/**
 * Wraps a molecule with controller and selectors for EntityDrillInView compatibility.
 *
 * This is a composable helper that takes any molecule created with createMolecule
 * and adds the controller + selectors pattern that EntityDrillInView expects.
 *
 * @example
 * ```typescript
 * // Create base molecule
 * const baseMolecule = createMolecule({
 *     name: 'myEntity',
 *     queryAtomFamily: myQueryAtomFamily,
 *     draftAtomFamily: myDraftAtomFamily,
 * })
 *
 * // Add controller support
 * export const myMolecule = withController(baseMolecule, {
 *     drillIn: {
 *         getChangesFromPath: (data, path, value) => {
 *             // Convert path update to draft changes
 *             return setValueAtPath(data, path, value)
 *         }
 *     }
 * })
 *
 * // Now use with EntityDrillInView
 * <EntityDrillInView
 *     entityId={id}
 *     entity={myMolecule}
 * />
 *
 * // Or use controller directly
 * const [state, dispatch] = useAtom(myMolecule.controller(id))
 * ```
 */
export function withController<
    T,
    TDraft,
    TMolecule extends {
        atoms: {
            data: AtomFamily<T | null>
            isDirty: AtomFamily<boolean>
            query: AtomFamily<QueryState<T>>
        }
        reducers: {
            update: Reducer<[id: string, changes: TDraft]>
            discard: Reducer<[id: string]>
        }
    },
>(
    molecule: TMolecule,
    config?: WithControllerConfig<T, TDraft>,
): MoleculeWithController<T, TDraft, TMolecule> {
    const controller = createControllerAtomFamily<T, TDraft>({
        dataAtom: molecule.atoms.data,
        isDirtyAtom: molecule.atoms.isDirty,
        queryAtom: molecule.atoms.query,
        updateReducer: molecule.reducers.update,
        discardReducer: molecule.reducers.discard,
        drillIn: config?.drillIn,
    })

    const selectors = {
        data: molecule.atoms.data,
        isDirty: molecule.atoms.isDirty,
        query: molecule.atoms.query,
    }

    return {
        ...molecule,
        controller,
        selectors,
    }
}
