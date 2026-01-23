/**
 * extendMolecule Helper
 *
 * Extends a base molecule with entity-specific atoms, reducers, and API.
 * Uses composition to add features without modifying the base molecule.
 */

import type {
    ExtendedAtoms,
    ExtendedGetters,
    ExtendedMolecule,
    ExtendedReducers,
    ExtendedSetters,
    ExtendMoleculeConfig,
    Molecule,
} from "./types"

/**
 * Extends a base molecule with additional atoms, reducers, and imperative API.
 *
 * @example
 * ```typescript
 * const testcaseBase = createMolecule<FlattenedTestcase>({
 *   name: 'testcase',
 *   queryAtomFamily: testcaseQueryFamily,
 *   draftAtomFamily: testcaseDraftFamily,
 * })
 *
 * export const testcaseMolecule = extendMolecule(testcaseBase, {
 *   atoms: {
 *     cell: cellAtomFamily,
 *     columns: currentColumnsAtom,
 *   },
 *   reducers: {
 *     addColumn: addColumnReducer,
 *     deleteColumn: deleteColumnReducer,
 *   },
 *   get: {
 *     cell: (id, column, options) =>
 *       getStore(options).get(cellAtomFamily({ id, column })),
 *   },
 *   set: {
 *     addColumn: (name, options) =>
 *       getStore(options).set(addColumnReducer, name),
 *   },
 * })
 * ```
 */
export function extendMolecule<
    T,
    TDraft,
    TAtoms extends ExtendedAtoms = Record<string, never>,
    TReducers extends ExtendedReducers = Record<string, never>,
    TGetters extends ExtendedGetters = Record<string, never>,
    TSetters extends ExtendedSetters = Record<string, never>,
>(
    base: Molecule<T, TDraft>,
    extensions: ExtendMoleculeConfig<TAtoms, TReducers, TGetters, TSetters>,
): ExtendedMolecule<T, TDraft, TAtoms, TReducers, TGetters, TSetters> {
    const {
        atoms: extAtoms = {},
        reducers: extReducers = {},
        get: extGet = {},
        set: extSet = {},
    } = extensions

    return {
        ...base,
        atoms: {
            ...base.atoms,
            ...extAtoms,
        },
        reducers: {
            ...base.reducers,
            ...extReducers,
        },
        get: {
            ...base.get,
            ...extGet,
        },
        set: {
            ...base.set,
            ...extSet,
        },
    } as ExtendedMolecule<T, TDraft, TAtoms, TReducers, TGetters, TSetters>
}

/**
 * Type helper to infer the extended molecule type
 */
export type InferExtendedMolecule<
    TBase extends Molecule<unknown, unknown>,
    TConfig extends ExtendMoleculeConfig<
        ExtendedAtoms<unknown>,
        ExtendedReducers,
        ExtendedGetters,
        ExtendedSetters
    >,
> =
    TBase extends Molecule<infer T, infer TDraft>
        ? TConfig extends ExtendMoleculeConfig<
              infer TAtoms,
              infer TReducers,
              infer TGetters,
              infer TSetters
          >
            ? ExtendedMolecule<T, TDraft, TAtoms, TReducers, TGetters, TSetters>
            : never
        : never
