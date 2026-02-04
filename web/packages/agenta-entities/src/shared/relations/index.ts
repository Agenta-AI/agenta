/**
 * Entity Relations
 *
 * Provides utilities for defining and querying entity parent-child relationships.
 *
 * @example
 * ```typescript
 * import {
 *   EntityRelation,
 *   entityRelationRegistry,
 *   extendWithRelations,
 * } from '@agenta/entities/shared'
 *
 * // Define a relation
 * const testcaseRelation: EntityRelation<Revision, Testcase> = {
 *   name: "testcases",
 *   parentType: "revision",
 *   childType: "testcase",
 *   childIdsPath: (rev) => rev.data?.testcase_ids ?? [],
 *   childMolecule: testcaseMolecule,
 *   mode: "populate",
 * }
 *
 * // Register for global discovery
 * entityRelationRegistry.register(testcaseRelation)
 *
 * // Extend molecule with relation atoms
 * const revisionWithRelations = extendWithRelations(revisionMolecule, {
 *   testcases: testcaseRelation,
 * })
 * ```
 */

// Registry
export {entityRelationRegistry, createRelationRegistry} from "./registry"
export type {RelationRegistry} from "./registry"

// Extension helper
export {
    extendWithRelations,
    createRelationIdsAtom,
    createRelationDataAtom,
} from "./extendWithRelations"
export type {MoleculeWithRelationAtoms} from "./extendWithRelations"

// Re-export relation types from molecule/types
export type {
    EntityRelation,
    ListQueryState,
    RelationSelectionConfig,
    RelationBindingConfig,
} from "../molecule/types"
export {hasSelectionConfig, hasBindingConfig} from "../molecule/types"

// Binding utilities
export {
    loadableBindingRelation,
    getLoadableId,
    parseLoadableId,
    isLoadableBindingId,
    getLoadableEntityType,
    getLoadableEntityId,
} from "./bindings"
export type {BindingFormat, ParsedBindingId} from "./bindings"
