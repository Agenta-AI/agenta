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
 * ```
 */

// Registry
export {entityRelationRegistry, createRelationRegistry} from "./registry"
export type {RelationRegistry} from "./registry"

// Relation atom types
export type {MoleculeWithRelationAtoms} from "./extendWithRelations"

// Re-export relation types from molecule/types
export type {
    EntityRelation,
    ListQueryState,
    RelationSelectionConfig,
    RelationBindingConfig,
} from "../molecule/types"

// Binding utilities
export {
    loadableBindingRelation,
    parseLoadableId,
} from "./bindings"
export type {BindingFormat, ParsedBindingId} from "./bindings"
