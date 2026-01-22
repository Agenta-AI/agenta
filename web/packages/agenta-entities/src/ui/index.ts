/**
 * Entity UI Utilities
 *
 * This module provides entity-specific UI utilities:
 *
 * 1. **Path utilities** - Navigate and manipulate nested data structures
 * 2. **DrillIn views** - Configurable drill-in for entity inspection
 * 3. **Entity modals** - Delete, commit, and save modals for entities
 * 4. **Entity selection** - Hierarchical entity selection (cascader, picker)
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
 *   EntityCascader,
 *   useEntitySelector,
 * } from '@agenta/entities/ui'
 *
 * // General UI components - import from @agenta/ui
 * import { Editor, ChatMessageEditor, LLMIconMap } from '@agenta/ui'
 * ```
 */

// ============================================================================
// PATH UTILITIES - imported from @agenta/shared
// ============================================================================

export {
    // Types
    type PathSegment,
    type DataPath,
    type PathItem,
    // Path operations
    getValueAtPath,
    setValueAtPath,
    deleteValueAtPath,
    hasValueAtPath,
    // Inspection
    isExpandable,
    getValueType,
    getChildCount,
    getItemsAtPath,
    // Path utilities
    parsePath,
    pathToString,
    getParentPath,
    getLastSegment,
    isChildPath,
    collectPaths,
} from "@agenta/shared"

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
    useDrillIn,
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
    // Note: SimpleChatMessage is now exported from ChatMessage module
    // Field Utilities
    tryParseAsObject,
    tryParseAsArray,
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
    type PromptSchemaControlProps,
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
} from "./modals"

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
    type AppRevisionSelectionResult,
    type EvaluatorRevisionSelectionResult,
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
    appRevisionAdapter,
    setAppRevisionAtoms,
    evaluatorRevisionAdapter,
    setEvaluatorRevisionAtoms,
    testsetAdapter,
    setTestsetAtoms,
    // State
    selectionMolecule,
    entitySelectorController,
    // Hooks
    useEntityList,
    useHierarchicalSelection,
    useMultiSelect,
    useLazyChildren,
    useEntitySelector,
    type UseEntityListOptions,
    type UseEntityListResult,
    type UseHierarchicalSelectionOptions,
    type UseHierarchicalSelectionResult,
    type UseMultiSelectOptions,
    type UseMultiSelectResult,
    type UseLazyChildrenOptions,
    type UseLazyChildrenResult,
    type CascaderOption,
    type UseEntitySelectorResult,
    // Components
    EntityBreadcrumb,
    EntityListItem,
    SearchInput,
    EntityPicker,
    EntityCascader,
    EntityListWithPopover,
    EntitySelectorModal,
    type EntityBreadcrumbProps,
    type EntityListItemProps,
    type SearchInputProps,
    type EntityPickerProps,
    type EntityCascaderProps,
    type EntityListWithPopoverProps,
    type EntitySelectorModalProps,
    // Initialization
    initializeSelectionSystem,
    resetSelectionSystem,
    isSelectionSystemInitialized,
    type SelectionSystemConfig,
    type TestsetSelectionConfig,
    type AppRevisionSelectionConfig,
    type EvaluatorRevisionSelectionConfig,
} from "./selection"
