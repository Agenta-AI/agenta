/**
 * UI Utilities for Entity Molecules
 *
 * This module provides entity-agnostic UI utilities that work with
 * the molecule pattern:
 *
 * 1. **Path utilities** - Navigate and manipulate nested data structures
 * 2. **DrillIn types** - Configure how entities are displayed in drill-in views
 * 3. **ClassNames API** - Ant Design v6 style customization for styling
 * 4. **Slots API** - Custom rendering for headers, content, actions
 *
 * @example
 * ```typescript
 * import {
 *   // Path utilities
 *   getValueAtPath,
 *   setValueAtPath,
 *   parsePath,
 *
 *   // DrillIn
 *   type DrillInMoleculeConfig,
 *   type MoleculeDrillInViewProps,
 *   defaultClassNames,
 *   createClassNameBuilder,
 * } from '@agenta/entities/ui'
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
    // Adapters
    createMoleculeDrillInAdapter,
    createReadOnlyDrillInAdapter,
    createEditableDrillInAdapter,
    type AdaptableMolecule,
    type CreateAdapterOptions,
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
} from "./selection"

// ============================================================================
// PRESENTATIONAL COMPONENTS - imported from @agenta/ui
// ============================================================================

export {
    // VersionBadge
    VersionBadge,
    formatVersion,
    type VersionBadgeProps,
    // RevisionLabel
    RevisionLabel,
    RevisionLabelInline,
    type RevisionLabelProps,
    // EntityPathLabel
    EntityPathLabel,
    buildEntityPath,
    formatEntityWithVersion,
    type EntityPathLabelProps,
    // EntityNameWithVersion
    EntityNameWithVersion,
    EntityNameVersionText,
    type EntityNameWithVersionProps,
} from "@agenta/ui"
