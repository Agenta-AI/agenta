/**
 * Entity UI Utilities
 *
 * This module provides entity-specific UI utilities:
 *
 * 1. **Path utilities** - Navigate and manipulate nested data structures
 * 2. **DrillIn views** - Configurable drill-in for entity inspection
 * 3. **Entity modals** - Delete, commit, and save modals for entities
 * 4. **Entity selection** - Unified EntityPicker with variant support
 *
 * For general UI components (Editor, ChatMessage, LLM icons), import from `@agenta/ui`.
 *
 * @example
 * ```typescript
 * // Entity-specific UI utilities
 * import {
 *   // Path utilities
 *   getValueAtPath,
 *   setValueAtPath,
 *   parsePath,
 *   // DrillIn
 *   MoleculeDrillInView,
 *   type DrillInMoleculeConfig,
 *   // Entity modals
 *   useEntityDelete,
 *   EntityCommitModal,
 *   // Entity selection
 *   EntityPicker,
 *   useEntitySelector,
 * } from '@agenta/entity-ui'
 *
 * // General UI components - import from @agenta/ui
 * import { Editor, ChatMessageEditor, LLMIconMap } from '@agenta/ui'
 * ```
 */

// NOTE: Path utilities (getValueAtPath, parsePath, etc.) are available from @agenta/shared/utils

export {SharedGenerationResultUtils, type SharedGenerationResultUtilsProps} from "./shared"
export {RunnableOutputValue, formatOutputValue, type RunnableOutputValueProps} from "./shared"

// ============================================================================
// DRILL-IN VIEW (Molecule-first API)
// ============================================================================

export {
    // Components
    MoleculeDrillInView,
    MoleculeDrillInBreadcrumb,
    MoleculeDrillInFieldList,
    MoleculeDrillInFieldItem,
    MoleculeDrillInProvider,
    PlaygroundConfigSection,
    useDrillIn,
    type PlaygroundConfigSectionProps,
    type ConfigSectionMoleculeAdapter,
    type EvaluatorPresetConfig,
    // Types - Molecule Config
    type DrillInMoleculeConfig,
    type DrillInDisplayConfig,
    type DrillInFieldBehaviors,
    type DrillInRenderers,
    type FieldRendererProps,
    // Types - ClassNames
    type DrillInClassNames,
    type DrillInStyles,
    type DrillInStateClassNames,
    // Types - Slots
    type DrillInSlots,
    type BreadcrumbSlotProps,
    type FieldHeaderSlotProps,
    type FieldContentSlotProps,
    type FieldActionsSlotProps,
    type EmptySlotProps,
    // Types - Component
    type MoleculeDrillInViewProps,
    type MoleculeDrillInAdapter,
    type MoleculeDrillInProviderProps,
    // ClassNames utilities
    drillInPrefixCls,
    defaultClassNames,
    defaultStateClassNames,
    mergeClassNames,
    buildClassName,
    createClassNameBuilder,
    useDrillInClassNames,
    // Context
    type DrillInContextValue,
    type DrillInProviderProps,
    defaultFieldBehaviors,
    // UI Injection Context
    DrillInUIProvider,
    useDrillInUI,
    defaultShowMessage,
    type DrillInUIComponents,
    type DrillInUIProviderProps,
    // Adapters
    createMoleculeDrillInAdapter,
    createReadOnlyDrillInAdapter,
    createEditableDrillInAdapter,
    type AdaptableMolecule,
    type CreateAdapterOptions,
    // Field Renderers
    BooleanField,
    DrillInFieldRenderer,
    JsonArrayField,
    JsonEditorWithLocalState,
    JsonObjectField,
    MessagesField,
    NumberField,
    RawModeDisplay,
    TextField,
    // Field Renderer Types
    type BaseFieldProps,
    type DrillInFieldRendererProps,
    type JsonArrayFieldProps,
    type JsonObjectFieldProps,
    type RawModeDisplayProps,
    type TextFieldProps,
    // Field Utilities
    // NOTE: For tryParseAsObject, tryParseAsArray, SimpleChatMessage - import from @agenta/shared
    getNestedValue,
    getArrayItemValue,
    canExpandValue,
    canExpandAsArray,
    canExpand,
    isChatMessageObject,
    isMessagesArray,
    parseMessages,
    canShowTextMode,
    getTextModeValue,
    textModeToStorageValue,
    formatForJsonDisplay,
    parseFromJsonDisplay,
    MAX_NESTED_DEPTH,
    // Core Components (dependency-free framework)
    DrillInBreadcrumb,
    DrillInControls,
    DrillInFieldHeader,
    DrillInContent,
    // Core Types
    type DrillInBreadcrumbProps,
    type DrillInControlsProps,
    type DrillInFieldHeaderProps,
    type DrillInContentWithRenderersProps,
    type DrillInContentProps,
    type PropertyType,
    type DataType,
    type ValueMode,
    type PathItem as DrillInPathItem,
    type SchemaInfo,
    type EntityDrillInAPI,
    type EntityControllerAPI,
    type EntityDualViewEditorProps,
    // Core Utilities
    getDefaultValue,
    propertyTypeToDataType,
    getItemCount,
    toTypedPath,
    formatSegment,
    generateFieldKey,
    formatLabel,
    canToggleRawMode,
    detectDataType,
    // Schema Controls
    NumberSliderControl,
    BooleanToggleControl,
    TextInputControl,
    EnumSelectControl,
    GroupedChoiceControl,
    MessagesSchemaControl,
    isMessagesSchema,
    ResponseFormatControl,
    responseFormatModalOpenAtom,
    PromptSchemaControl,
    isPromptSchema,
    isPromptValue,
    ToolItemControl,
    TOOL_PROVIDERS_META,
    TOOL_SPECS,
    ObjectSchemaControl,
    CollapsibleObjectControl,
    SchemaPropertyRenderer,
    // Schema Utilities
    resolveAnyOfSchema,
    hasGroupedChoices,
    isLLMConfigLike,
    shouldRenderObjectInline,
    getModelSchema,
    getResponseFormatSchema,
    getLLMConfigProperties,
    getLLMConfigValue,
    hasNestedLLMConfig,
    normalizeMessages,
    denormalizeMessages,
    getOptionsFromSchema,
    type OptionGroup,
    // Schema Control Types
    type NumberSliderControlProps,
    type BooleanToggleControlProps,
    type TextInputControlProps,
    type EnumSelectControlProps,
    type GroupedChoiceControlProps,
    type MessagesSchemaControlProps,
    type ResponseFormatValue,
    type ResponseFormatControlProps,
    FeedbackConfigurationControl,
    type FeedbackConfigurationControlProps,
    type FeedbackConfig,
    type ResponseFormatType,
    type CategoricalOption,
    type PromptSchemaControlProps,
    type ToolItemControlProps,
    type ToolObj,
    type ToolFunction,
    type ObjectSchemaControlProps,
    type SchemaPropertyRendererProps,
} from "./DrillInView"

// ============================================================================
// ENTITY MODALS
// ============================================================================

export {
    // Types
    type EntityType,
    type EntityReference,
    type EntityGroup,
    type CommitParams,
    type SaveParams,
    type EntityModalAdapter,
    type DeleteModalState,
    type EntityDeleteModalProps,
    type CommitModalState,
    type SaveModalState,
    // Utilities
    groupEntitiesByType,
    getEntityTypeLabel,
    // Adapter registry
    registerEntityAdapter,
    getEntityAdapter,
    hasEntityAdapter,
    getRegisteredEntityTypes,
    createEntityAdapter,
    createAndRegisterEntityAdapter,
    type CreateEntityAdapterOptions,
    // Delete modal components
    EntityDeleteModal,
    EntityDeleteTitle,
    EntityDeleteContent,
    EntityDeleteFooter,
    // Delete modal hooks
    useEntityDelete,
    useTestsetDelete,
    useVariantDelete,
    useEvaluatorDelete,
    type UseEntityDeleteReturn,
    // Delete modal state atoms
    deleteModalOpenAtom,
    deleteModalEntitiesAtom,
    deleteModalLoadingAtom,
    deleteModalErrorAtom,
    deleteModalGroupsAtom,
    deleteModalWarningsAtom,
    deleteModalCanProceedAtom,
    deleteModalStateAtom,
    openDeleteModalAtom,
    closeDeleteModalAtom,
    resetDeleteModalAtom,
    executeDeleteAtom,
    // Commit modal components
    EntityCommitModal,
    EntityCommitTitle,
    EntityCommitContent,
    EntityCommitFooter,
    // Commit modal hooks
    useEntityCommit,
    useRevisionCommit,
    useVariantCommit,
    useBoundCommit,
    type UseEntityCommitReturn,
    type UseBoundCommitOptions,
    type UseBoundCommitReturn,
    type EntityCommitModalProps,
    type CommitSubmitParams,
    type CommitSubmitResult,
    type CommitModeOption,
    // Commit modal state atoms
    commitModalOpenAtom,
    commitModalEntityAtom,
    commitModalMessageAtom,
    commitModalLoadingAtom,
    commitModalErrorAtom,
    commitModalEntityNameAtom,
    commitModalCanCommitAtom,
    commitModalCanProceedAtom,
    commitModalStateAtom,
    openCommitModalAtom,
    closeCommitModalAtom,
    resetCommitModalAtom,
    setCommitMessageAtom,
    setCommitLoadingAtom,
    setCommitErrorAtom,
    executeCommitAtom,
    // Save modal components
    EntitySaveModal,
    EntitySaveTitle,
    EntitySaveContent,
    EntitySaveFooter,
    // Save modal hooks
    useEntitySave,
    useTestsetSave,
    useVariantSave,
    type UseEntitySaveReturn,
    type EntitySaveModalProps,
    // Save modal state atoms
    saveModalOpenAtom,
    saveModalEntityAtom,
    saveModalEntityTypeAtom,
    saveModalNameAtom,
    saveModalSaveAsNewAtom,
    saveModalLoadingAtom,
    saveModalErrorAtom,
    saveModalResolvedTypeAtom,
    saveModalOriginalNameAtom,
    saveModalNameModifiedAtom,
    saveModalCanProceedAtom,
    saveModalTitleAtom,
    saveModalStateAtom,
    openSaveModalAtom,
    openSaveNewModalAtom,
    closeSaveModalAtom,
    resetSaveModalAtom,
    setSaveNameAtom,
    toggleSaveAsNewAtom,
    executeSaveAtom,
    // Unified save/commit hook
    useSaveOrCommit,
    createBoundSaveOrCommit,
    getSaveOrCommitLabel,
    getSaveOrCommitIconName,
    type EntityState,
    type SaveOrCommitOptions,
    type UseSaveOrCommitReturn,
    // Unified action dispatch
    EntityActionProvider,
    useEntityActionDispatch,
    useEntityActionState,
    useEntityActionGuard,
    reduceEntityModalAction,
    commitAction,
    saveAction,
    createAction,
    deleteAction,
    saveOrCommitAction,
    type EntityModalAction,
    type CommitAction,
    type SaveAction,
    type CreateAction,
    type DeleteAction,
    type SaveOrCommitAction,
    type ActiveModal,
    type EntityActionState,
    type EntityActionDispatch,
    type EntityActionContextValue,
    type EntityActionProviderProps,
    type EntityActionHelpers,
    // Combined provider (recommended)
    EntityModalsProvider,
    type EntityModalsProviderProps,
    // Preset modal
    LoadEvaluatorPresetModal,
    type EvaluatorPreset,
    type LoadEvaluatorPresetModalProps,
} from "./modals"

// ============================================================================
// TESTCASE UI COMPONENTS
// ============================================================================

export {TestcaseTable, type TestcaseTableProps} from "./testcase"

// ============================================================================
// ENTITY SELECTION
// ============================================================================

export {
    // Types
    type SelectableEntityType,
    type EntitySelectionResult,
    type SelectionPathItem,
    type HierarchyLevel,
    type HierarchyConfig,
    type EntitySelectionAdapter,
    type HierarchicalSelectionState,
    type EntitySelectorConfig,
    type EntitySelectorResolver,
    type ListQueryState,
    type CreateHierarchyLevelOptions,
    type CreateSelectionAdapterOptions,
    type EvaluatorSelectionResult,
    type LegacyEvaluatorSelectionResult,
    type EvaluatorRevisionSelectionResult,
    type EvaluatorRevisionRelationSelectionResult,
    type TestsetSelectionResult,
    // Adapter factory
    createAdapter as createSelectionAdapter,
    registerSelectionAdapter,
    getSelectionAdapter,
    hasSelectionAdapter,
    getRegisteredAdapterNames as getRegisteredSelectionAdapterNames,
    clearSelectionAdapterRegistry,
    createAndRegisterAdapter as createAndRegisterSelectionAdapter,
    resolveAdapter as resolveSelectionAdapter,
    // Pre-built adapters
    legacyAppRevisionAdapter,
    evaluatorAdapter,
    setEvaluatorAtoms,
    legacyEvaluatorAdapter,
    setLegacyEvaluatorAtoms,
    evaluatorRevisionAdapter,
    setEvaluatorRevisionAtoms,
    evaluatorRevisionRelationAdapter,
    testsetAdapter,
    // State
    selectionMolecule,
    entitySelectorController,
    // Hooks
    useEntitySelection,
    useCascadingMode,
    useBreadcrumbMode,
    useListPopoverMode,
    useEntitySelectionCore,
    useEntitySelector,
    useChildrenData,
    useAutoSelectLatestChild,
    getLevelLabel,
    getLevelPlaceholder,
    type EntitySelectionMode,
    type UseEntitySelectionOptions,
    type UseEntitySelectionResult,
    type CascadingModeOptions,
    type BreadcrumbModeOptions,
    type ListPopoverModeOptions,
    type UseCascadingModeOptions,
    type UseCascadingModeResult,
    type UseBreadcrumbModeOptions,
    type UseBreadcrumbModeResult,
    type UseListPopoverModeOptions,
    type UseListPopoverModeResult,
    type CascadingLevelState,
    type ListPopoverParentState,
    type ListPopoverChildrenState,
    type EntitySelectionCoreOptions,
    type EntitySelectionCoreResult,
    type UseEntitySelectorResult,
    type UseAutoSelectLatestChildOptions,
    // Components
    EntityBreadcrumb,
    EntityListItem,
    SearchInput,
    EntityPicker,
    CascadingVariant,
    BreadcrumbVariant,
    ListPopoverVariant,
    LevelSelect,
    ChildPopoverContent,
    AutoSelectHandler,
    EntitySelectorModal,
    type EntityBreadcrumbProps,
    type EntityListItemProps,
    type SearchInputProps,
    type EntityPickerVariant,
    type EntityPickerProps,
    type EntityPickerBaseProps,
    type CascadingVariantProps,
    type BreadcrumbVariantProps,
    type ListPopoverVariantProps,
    type LevelSelectProps,
    type ChildPopoverContentProps,
    type AutoSelectHandlerProps,
    type EntitySelectorModalProps,
    // Initialization
    initializeSelectionSystem,
    resetSelectionSystem,
    isSelectionSystemInitialized,
    type SelectionSystemConfig,
    type LegacyEvaluatorSelectionConfig,
    type EvaluatorRevisionSelectionConfig,
} from "./selection"

// ============================================================================
// ENTITY TABLE (Generic entity list table)
// ============================================================================

export {EntityTable, type EntityTableProps} from "./shared"

// ============================================================================
// ENTITY ADAPTERS (registration for entity modals)
// ============================================================================

export {testsetModalAdapter, revisionModalAdapter, variantModalAdapter} from "./adapters"
