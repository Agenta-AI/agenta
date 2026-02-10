/**
 * Shared entity utilities and patterns
 *
 * This module provides reusable patterns and utilities for working with entities
 * across different entity types (testsets, testcases, traces, etc.)
 *
 * ## Module Structure
 *
 * - **molecule/**: Core entity molecule pattern (createMolecule, controllers, draft state)
 * - **utils/**: Common utilities (schema, transforms, helpers)
 *
 * @module shared
 */

// ============================================================================
// MOLECULE PATTERN (Single Entity)
// ============================================================================

export {
    // Core factory
    createMolecule,
    // Extension helper
    extendMolecule,
    type InferExtendedMolecule,
    // List extension factory
    createListExtension,
    type CreateListExtensionConfig,
    type ListExtension,
    type ListExtensionAtoms,
    type ListExtensionReducers,
    type InferListExtension,
    // Controller patterns
    createControllerAtomFamily,
    createSelectorsAlias,
    withController,
    type ControllerAtomFamily,
    type ControllerState,
    type ControllerAction,
    type ControllerDrillInConfig,
    type CreateControllerConfig,
    type ControllerDataPath,
    type MoleculeWithController,
    type WithControllerConfig,
    // Entity controller
    createEntityController,
    type DrillInConfig,
    type DrillInValueMode,
    type EntityAction,
    type EntityAPI,
    type EntityActions,
    type EntityControllerAtomFamily,
    type EntityControllerConfig,
    type EntityControllerState,
    type EntityDrillIn,
    type EntitySchemaSelectors,
    type EntitySelectors,
    type PathItem,
    type QueryState,
    type SchemaProperty,
    type UseEntityControllerResult,
    // Draft state
    createEntityDraftState,
    normalizeValueForComparison,
    // Local molecule
    createLocalMolecule,
    // Types
    type Store,
    type StoreOptions,
    type MoleculeQueryState,
    type AtomFamily,
    type WritableAtomFamily,
    type FlexibleWritableAtomFamily,
    type MoleculeAtoms,
    type MoleculeReducers,
    type Reducer,
    type MoleculeGetters,
    type MoleculeSetters,
    type MoleculeCleanup,
    type LifecycleCallback,
    type LifecycleUnsubscribe,
    type LifecycleEvent,
    type MoleculeLifecycle,
    type LifecycleConfig,
    type MoleculeState,
    type MoleculeDispatch,
    type UseControllerResult,
    type Molecule,
    type CreateMoleculeConfig,
    type ExtendedAtoms,
    type ExtendedReducers,
    type ExtendedGetters,
    type ExtendedSetters,
    type ExtendMoleculeConfig,
    type ExtendedMolecule,
    type LocalMolecule,
    type CreateLocalMoleculeConfig,
    type LocalQueryState,
    type CacheKeyConfig,
    type CacheRedirectEntry,
    type CacheConfig,
    type MoleculeRelation,
    type MoleculeWithRelations,
    type InferSchemaType,
    type ServerEntity,
    type LocalEntity,
    type AnyEntity,
    isLocalEntity,
    isServerEntity,
    getEntityId,
    // ============================================================================
    // PUBLIC API INTERFACES (Clean entity controller pattern)
    // ============================================================================
    // Entity controller interface (uniform base API)
    type EntityController,
    // Capability interfaces
    type RunnableCapability,
    type LoadableCapability,
    // Combined entity types
    type RunnableEntity,
    type LoadableEntity,
    type RunnableLoadableEntity,
} from "./molecule"

// ============================================================================
// UTILITIES
// ============================================================================

export {
    // Schema utilities (JSON Schema / UI Schema)
    type EntitySchemaProperty,
    type EvaluatorField,
    type EntitySchema,
    getSchemaAtPath,
    getSchemaKeys,
    isArrayPath,
    getDefaultValue,
    createDefaultArrayItem,
    evaluatorFieldToSchema,
    evaluatorFieldsToSchema,
    extractPromptSchema,
    extractCustomPropertiesSchema,
    messageSchema,
    messagesSchema,
    // Zod schema utilities
    type SafeParseResult,
    type EntitySchemaSetConfig,
    type EntitySchemaSet,
    type LocalEntityFactory,
    type InferBase,
    type InferCreate,
    type InferUpdate,
    type InferLocal,
    createEntitySchemaSet,
    createLocalEntityFactory,
    createTrackedEntityFactory,
    defaultIdGenerator,
    safeParseWithErrors,
    safeParseWithLogging,
    parseOrThrow,
    createPaginatedResponseSchema,
    createBatchOperationSchema,
    timestampFieldsSchema,
    auditFieldsSchema,
    jsonValueSchema,
    COMMON_SERVER_FIELDS,
    // Transform utilities
    type TimestampFields,
    type DateParser,
    createTimestampNormalizer,
    createFieldTransformer,
    composeTransforms,
    parseISODate,
    normalizeTimestampsBasic,
    // ID & batch utilities
    isLocalId,
    isServerId,
    generateLocalId,
    batchUpdate,
    batchCreate,
    batchDelete,
    // Relation utilities
    getChildIds,
    getChildData,
    createRelation,
    // Latest entity query factory
    createLatestEntityQueryFactory,
    type CreateLatestEntityQueryConfig,
    type LatestEntityQueryParams,
    // Null-safe atom utilities
    createNullQueryResultAtom,
    createNullDataAtom,
    createNullSafeQuerySelector,
    createNullSafeDataSelector,
    createNullSafeSelectors,
    type NullQueryResult,
    type AtomFamilyFn,
    type CreateNullSafeSelectorsConfig,
    type NullSafeSelectors,
    // Revision label utilities
    type VersionedEntity,
    type RevisionLabelOptions,
    type RevisionLabelInfo,
    isLocalDraftId,
    extractSourceIdFromDraft,
    isPlaceholderId,
    getVersionLabel,
    formatLocalDraftLabel,
    getRevisionLabel,
    getFullRevisionLabel,
    getRevisionLabelInfo,
} from "./utils"

// ============================================================================
// USER RESOLUTION
// ============================================================================

export {
    // Configuration
    setUserAtoms,
    // Atoms
    userByIdFamily,
    currentUserAtom,
    // Hooks
    useUserDisplayName,
    useIsCurrentUser,
    // Components
    UserAuthorLabel,
    // Types
    type UserAtomConfig,
    type UserInfo,
    type UserAuthorLabelProps,
} from "./user"

// ============================================================================
// STUB MOLECULE (for optional/feature-flagged entities)
// ============================================================================

export {
    createStubMolecule,
    isStubMolecule,
    type StubQueryState,
    type StubMoleculeSelectors,
    type CreateStubMoleculeConfig,
    type StubMolecule,
} from "./stubMolecule"

// ============================================================================
// ENTITY BRIDGE (unified loadable/runnable controllers)
// ============================================================================

export {
    // Factories
    createLoadableBridge,
    createRunnableBridge,
    // Internal state (advanced)
    loadableStateFamily,
} from "./createEntityBridge"

export type {
    // Core types
    BridgeQueryState,
    BaseMolecule,
    BaseMoleculeSelectors,
    // Loadable types
    LoadableRow,
    LoadableColumn,
    LoadableSourceConfig,
    CreateLoadableBridgeConfig,
    LoadableBridge,
    LoadableBridgeSelectors,
    LoadableBridgeActions,
    // Runnable types
    RunnablePort,
    RunnableData,
    RunnableTypeConfig,
    CreateRunnableBridgeConfig,
    RunnableBridge,
    RunnableBridgeSelectors,
    // Aliases
    SourceConfig,
    RunnableConfig,
} from "./entityBridge"

// ============================================================================
// ENTITY RELATIONS (parent-child relationship management)
// ============================================================================

export {
    // Registry
    entityRelationRegistry,
    createRelationRegistry,
    // Extension helper
    extendWithRelations,
    createRelationIdsAtom,
    createRelationDataAtom,
    // Type guards
    hasSelectionConfig,
    hasBindingConfig,
    // Binding utilities
    loadableBindingRelation,
    getLoadableId,
    parseLoadableId,
    isLoadableBindingId,
    getLoadableEntityType,
    getLoadableEntityId,
} from "./relations"

export type {
    // Registry types
    RelationRegistry,
    // Extension types
    MoleculeWithRelationAtoms,
    // Relation types
    EntityRelation,
    ListQueryState,
    RelationSelectionConfig,
    RelationBindingConfig,
    // Binding types
    BindingFormat,
    ParsedBindingId,
} from "./relations"

// ============================================================================
// ENTITY DATA CONTROLLER (unified table data access factory)
// ============================================================================

export {
    createEntityDataController,
    type EntityColumnDef,
    type EntityRowBase,
    type EntityDataConfigBase,
    type CreateEntityDataControllerConfig,
    type EntityDataController,
} from "./createEntityDataController"

// ============================================================================
// LIST COUNTS (unified count summaries for paginated and regular lists)
// ============================================================================

export {
    // Types
    type TotalCountMode,
    type ListCountsConfig,
    type LocalDelta,
    type EntityListCounts,
    type PaginationState,
    // Helpers
    defaultIsRowCountable,
    hasMorePages,
    formatListCountLabel,
    formatListCountLabelShort,
    computeListCounts,
    // Paginated list counts
    createPaginatedListCountsAtom,
    createPaginatedListCountsAtomFamily,
    // Regular list counts
    createListCountsAtom,
    createListCountsFromPaginationAtom,
    // Utility atoms
    createDisplayLabelAtom,
    createDisplayLabelShortAtom,
    createHasMoreAtom,
} from "./listCounts"

// ============================================================================
// TABLE TYPES (local definitions to avoid @agenta/ui dependency)
// ============================================================================

export type {
    InfiniteTableRowBase,
    WindowingState,
    InfiniteTableFetchResult,
    BaseTableMeta,
    PaginatedControllerParams,
    PaginatedCombinedState,
    PaginatedControllerAction,
    PaginatedControllerState,
    PaginatedEntityStore,
    GroupableColumn,
} from "./tableTypes"

// ============================================================================
// PAGINATED STORE (self-contained pagination infrastructure)
// ============================================================================

export {
    // Core stores
    createInfiniteTableStore,
    createInfiniteDatasetStore,
    createSimpleTableStore,
    createTableMetaAtom,
    // Paginated entity store (main factory)
    createPaginatedEntityStore,
    // Row helpers
    createTableRowHelpers,
    // React hook
    useInfiniteTablePagination,
    // Types (note: EntityListCounts, ListCountsConfig, TotalCountMode already exported from ./listCounts)
    type InfiniteTableStore,
    type TableRowAtomKey,
    type TablePagesKey,
    type InfiniteDatasetStore,
    type InfiniteDatasetStoreConfig,
    type DateRangeFilter,
    type SimpleTableStore,
    type SimpleTableStoreConfig,
    type PaginatedEntityRow,
    type PaginatedEntityRowConfig,
    type PaginatedEntityStoreConfig,
    type PaginatedEntityMeta,
    type PaginatedFetchParams,
    type PaginatedState,
    type CreateSkeletonRowParams,
    type MergeRowParams,
    type TableRowHelpers,
    type TableRowHelpersConfig,
} from "./paginated"

// ============================================================================
// REVISION UTILITIES (shared between appRevision and legacyAppRevision)
// ============================================================================

export {
    // Type guards
    isArray,
    isRecord,
    toArray,
    isValidUUID,
    // URI parsing
    type ParsedUriInfo,
    parseRevisionUri,
    extractRuntimePrefix,
    extractRoutePath,
    // Revision parameter extraction
    type RawAgConfig,
    extractRevisionParameters,
    extractRevisionParametersFromEnhanced,
    extractRevisionParametersFromApiRevision,
    // Deprecated agConfig aliases
    extractAgConfig,
    extractAgConfigFromEnhanced,
    extractAgConfigFromApiRevision,
    // List item types
    type AppListItem,
    type VariantListItem,
    type RevisionListItem,
    // API response types
    type ApiVariant,
    type ApiRevisionListItem,
    type ApiApp,
    // Transform utilities
    transformAppToListItem,
    transformVariantToListItem,
    transformRevisionToListItem,
    // Enhanced variant types
    type EnhancedVariantLike,
    extractUriFromEnhanced,
} from "./utils"
