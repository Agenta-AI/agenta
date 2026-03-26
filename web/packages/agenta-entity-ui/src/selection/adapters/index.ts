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

// Evaluator adapter (1-level: flat evaluator list)
// Used in playground for chaining evaluators as downstream nodes
export {evaluatorAdapter, setEvaluatorAtoms} from "./evaluatorAdapter"
export type {EvaluatorSelectionResult} from "./evaluatorAdapter"

// Workflow revision adapter (3-level: Workflow → Variant → Revision)
// Uses atoms and relations from @agenta/entities/workflow
// Configurable via WorkflowQueryFlags for different model types (app, evaluator, etc.)
export {
    workflowRevisionAdapter,
    createWorkflowRevisionAdapter,
} from "./workflowRevisionRelationAdapter"
export type {
    WorkflowRevisionSelectionResult,
    CreateWorkflowRevisionAdapterOptions,
} from "./workflowRevisionRelationAdapter"

// ============================================================================
// ENRICHED EVALUATOR ADAPTERS
// ============================================================================

// Label utilities for evaluator workflow items (colored type tags)
export {renderEvaluatorPickerLabelNode, buildEvaluatorPickerLabelNode} from "./evaluatorLabelUtils"

// Enriched adapter hooks with auto-fetching evaluator template data
export {
    useEvaluatorEnrichedData,
    useEnrichedEvaluatorBrowseAdapter,
    useEnrichedEvaluatorOnlyAdapter,
    useEnrichedHumanEvaluatorAdapter,
    useEnrichedAnnotationEvaluatorAdapter,
} from "./useEnrichedEvaluatorAdapter"
