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

// Pre-built adapters
export {appRevisionAdapter, setAppRevisionAtoms} from "./appRevisionAdapter"
export type {AppRevisionSelectionResult} from "./appRevisionAdapter"

export {evaluatorRevisionAdapter, setEvaluatorRevisionAtoms} from "./evaluatorRevisionAdapter"
export type {EvaluatorRevisionSelectionResult} from "./evaluatorRevisionAdapter"

export {testsetAdapter, setTestsetAtoms} from "./testsetAdapter"
export type {TestsetSelectionResult} from "./testsetAdapter"
