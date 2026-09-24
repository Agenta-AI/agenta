/**
 * Relation atom types
 *
 * Describes a molecule extended with relation-derived atoms following the
 * molecule.atoms.* pattern.
 */

import type {Atom} from "jotai"

import type {EntityRelation, Molecule} from "../molecule/types"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Molecule extended with relation-derived atoms.
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
