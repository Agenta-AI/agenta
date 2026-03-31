/**
 * extendWithRelations Helper
 *
 * Extends a molecule with relation-derived atoms following the molecule.atoms.* pattern.
 * Creates parameterized atoms for accessing child IDs and child data.
 */

import {atom} from "jotai"
import type {Atom} from "jotai"
import {atomFamily} from "jotai-family"

import type {EntityRelation, LocalMolecule, Molecule} from "../molecule/types"
import {getChildData, getChildIds} from "../utils/helpers"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result type for extendWithRelations.
 * Adds atoms for each relation following the molecule.atoms.* pattern:
 * - atoms.{relationName}Ids(parentId) → Atom<string[]>
 * - atoms.{relationName}(parentId) → Atom<(TChild | null)[]>
 */
export type MoleculeWithRelationAtoms<
    T,
    TDraft,
    TRelations extends Record<string, EntityRelation<T, unknown>>,
> = Molecule<T, TDraft> & {
    atoms: Molecule<T, TDraft>["atoms"] & {
        [K in keyof TRelations as `${K & string}Ids`]: (parentId: string) => Atom<string[]>
    } & {
        [K in keyof TRelations]: TRelations[K] extends EntityRelation<T, infer TChild>
            ? (parentId: string) => Atom<(TChild | null)[]>
            : never
    }
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Extend a molecule with relation-derived atoms.
 *
 * For each relation, creates two atom families:
 * - `atoms.{name}Ids(parentId)` - Returns child IDs
 * - `atoms.{name}(parentId)` - Returns child entities
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
 * }
 *
 * const revisionWithRelations = extendWithRelations(revisionMolecule, {
 *   testcases: testcaseRelation,
 * })
 *
 * // Use in components
 * const testcaseIds = useAtomValue(revisionWithRelations.atoms.testcasesIds(revisionId))
 * const testcases = useAtomValue(revisionWithRelations.atoms.testcases(revisionId))
 * ```
 */
export function extendWithRelations<
    T,
    TDraft,
    TRelations extends Record<string, EntityRelation<T, unknown>>,
>(
    molecule: Molecule<T, TDraft>,
    relations: TRelations,
): MoleculeWithRelationAtoms<T, TDraft, TRelations> {
    // Build relation atoms
    const relationAtoms: Record<string, (parentId: string) => Atom<unknown>> = {}

    for (const [name, relation] of Object.entries(relations)) {
        // Create atom family for child IDs: atoms.{name}Ids(parentId)
        const idsAtomFamily = atomFamily((parentId: string) =>
            atom((get) => {
                const parent = get(molecule.atoms.data(parentId))
                return getChildIds(parent, relation)
            }),
        )
        relationAtoms[`${name}Ids`] = idsAtomFamily

        // Create atom family for child data: atoms.{name}(parentId)
        const childMolecule = relation.childMolecule as
            | Molecule<unknown, unknown>
            | LocalMolecule<unknown>

        const dataAtomFamily = atomFamily((parentId: string) =>
            atom((get) => {
                const parent = get(molecule.atoms.data(parentId))
                if (!parent) return []

                // If mode is 'populate' and we have embedded data, use it
                if (relation.mode === "populate" && relation.childDataPath) {
                    const embedded = getChildData(parent, relation)
                    if (embedded.length > 0) {
                        return embedded
                    }
                }

                // Otherwise, read from child molecule by IDs
                const ids = getChildIds(parent, relation)
                return ids.map((id) => get(childMolecule.atoms.data(id)))
            }),
        )
        relationAtoms[name] = dataAtomFamily
    }

    // Return extended molecule
    return {
        ...molecule,
        atoms: {
            ...molecule.atoms,
            ...relationAtoms,
        },
    } as MoleculeWithRelationAtoms<T, TDraft, TRelations>
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Create a single relation atom for child IDs.
 * Use this when you need a one-off relation atom without extending the molecule.
 *
 * @example
 * ```typescript
 * const testcaseIdsAtom = createRelationIdsAtom(
 *   revisionMolecule,
 *   revisionId,
 *   testcaseRelation
 * )
 * ```
 */
export function createRelationIdsAtom<T, TChild>(
    molecule: Molecule<T, unknown>,
    parentId: string,
    relation: EntityRelation<T, TChild>,
): Atom<string[]> {
    return atom((get) => {
        const parent = get(molecule.atoms.data(parentId))
        return getChildIds(parent, relation)
    })
}

/**
 * Create a single relation atom for child data.
 * Use this when you need a one-off relation atom without extending the molecule.
 *
 * @example
 * ```typescript
 * const testcasesAtom = createRelationDataAtom(
 *   revisionMolecule,
 *   revisionId,
 *   testcaseRelation
 * )
 * ```
 */
export function createRelationDataAtom<T, TChild>(
    molecule: Molecule<T, unknown>,
    parentId: string,
    relation: EntityRelation<T, TChild>,
): Atom<(TChild | null)[]> {
    const childMolecule = relation.childMolecule as
        | Molecule<TChild, unknown>
        | LocalMolecule<TChild>

    return atom((get) => {
        const parent = get(molecule.atoms.data(parentId))
        if (!parent) return []

        // If mode is 'populate' and we have embedded data, use it
        if (relation.mode === "populate" && relation.childDataPath) {
            const embedded = getChildData(parent, relation)
            if (embedded.length > 0) {
                return embedded
            }
        }

        // Otherwise, read from child molecule by IDs
        const ids = getChildIds(parent, relation)
        return ids.map((id) => get(childMolecule.atoms.data(id)))
    })
}
