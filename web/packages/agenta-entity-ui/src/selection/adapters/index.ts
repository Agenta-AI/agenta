/**
 * Entity Selection Adapters
 *
 * Adapter pattern for connecting entity molecules to selection UI.
 */

// Types
export type {
    CreateHierarchyLevelOptions,
    CreateSelectionAdapterOptions,
    AdapterRegistryEntry,
    AdapterRegistry,
    SelectableEntityType,
    EntitySelectionResult,
    SelectionPathItem,
    HierarchyLevel,
    EntitySelectionAdapter,
    ListQueryState,
} from "./types"

// Factory and registry
export {
    createAdapter,
    registerSelectionAdapter,
    getSelectionAdapter,
    hasSelectionAdapter,
    getRegisteredAdapterNames,
    clearSelectionAdapterRegistry,
    createAndRegisterAdapter,
    resolveAdapter,
} from "./createAdapter"

// Revision level factory for git-based entities
export {
    createRevisionLevel,
    createTestsetRevisionLevel,
    createAppRevisionLevel,
    createEvaluatorRevisionLevel,
} from "./revisionLevelFactory"
export type {
    RevisionEntity,
    RevisionFieldMappings,
    CreateRevisionLevelOptions,
} from "./revisionLevelFactory"

// Relation-based factories
export {
    createLevelFromRelation,
    createRootLevelFromRelation,
    createMiddleLevelFromRelation,
    createLeafLevelFromRelation,
} from "./createLevelFromRelation"
export type {CreateLevelFromRelationOptions} from "./createLevelFromRelation"

export {
    createAdapterFromRelations,
    createTwoLevelAdapter,
    createThreeLevelAdapter,
} from "./createAdapterFromRelations"
export type {
    LevelOverride,
    RootLevelConfig,
    ChildLevelConfig,
    CreateAdapterFromRelationsOptions,
} from "./createAdapterFromRelations"

// ============================================================================
// PRE-BUILT ADAPTERS (Relation-Based)
// ============================================================================

// Testset adapter (2-level: Testset → Revision)
// Uses atoms and relations from @agenta/entities/testset
export {testsetAdapter} from "./testsetRelationAdapter"
export type {TestsetSelectionResult} from "./testsetRelationAdapter"

// App revision adapter (3-level: App → Variant → Revision)
// Uses atoms and relations from @agenta/entities/appRevision
export {appRevisionAdapter} from "./appRevisionRelationAdapter"
export type {AppRevisionSelectionResult} from "./appRevisionRelationAdapter"

// OSS App revision adapter (3-level: App → Variant → Revision)
// Uses atoms and relations from @agenta/entities/legacyAppRevision (legacy API)
// Also exports createLegacyAppRevisionAdapter for configurable 2-level mode
export {
    legacyAppRevisionAdapter,
    createLegacyAppRevisionAdapter,
} from "./legacyAppRevisionRelationAdapter"
export type {
    LegacyAppRevisionSelectionResult,
    CreateLegacyAppRevisionAdapterOptions,
} from "./legacyAppRevisionRelationAdapter"

// Evaluator adapter (1-level: flat evaluator list)
// Used in playground for chaining evaluators as downstream nodes
export {evaluatorAdapter, setEvaluatorAtoms} from "./evaluatorAdapter"
export type {EvaluatorSelectionResult} from "./evaluatorAdapter"

// Legacy evaluator adapter (1-level: flat evaluator list)
// Uses the SimpleEvaluator facade API (`/preview/simple/evaluators/`)
export {legacyEvaluatorAdapter, setLegacyEvaluatorAtoms} from "./legacyEvaluatorAdapter"
export type {LegacyEvaluatorSelectionResult} from "./legacyEvaluatorAdapter"

// Evaluator revision adapter (3-level: Evaluator → Variant → Revision)
// Uses legacy runtime configuration pattern (no evaluator relations yet)
export {evaluatorRevisionAdapter, setEvaluatorRevisionAtoms} from "./evaluatorRevisionAdapter"
export type {EvaluatorRevisionSelectionResult} from "./evaluatorRevisionAdapter"

// Evaluator revision relation adapter (2-level: Evaluator → Revision, skips Variant)
// Uses atoms and relations from @agenta/entities/evaluator
// Designed for list-popover variant but works with cascading/breadcrumb too
export {evaluatorRevisionRelationAdapter} from "./evaluatorRevisionRelationAdapter"
export type {EvaluatorRevisionRelationSelectionResult} from "./evaluatorRevisionRelationAdapter"
