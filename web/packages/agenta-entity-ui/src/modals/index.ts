/**
 * Entity Modals
 *
 * Reusable modal components for entity operations (delete, commit, save).
 * Uses molecule-first architecture with adapter-based entity configuration.
 *
 * @example
 * ```tsx
 * import {
 *   EntityDeleteModal,
 *   useEntityDelete,
 *   registerEntityAdapter,
 * } from '@agenta/entity-ui/modals'
 *
 * // Register your entity adapter
 * registerEntityAdapter(testsetAdapter)
 *
 * // Use the delete hook
 * const {deleteEntity} = useEntityDelete()
 *
 * // Render the modal (once per page)
 * <EntityDeleteModal />
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

export type {
    EntityType,
    EntityReference,
    EntityGroup,
    CommitParams,
    CommitChangesSummary,
    CommitVersionInfo,
    CommitDiffData,
    CommitContext,
    SaveParams,
    EntityModalAdapter,
    EntityDeleteModalProps,
} from "./types"

export {groupEntitiesByType, getEntityTypeLabel} from "./types"

// ============================================================================
// ADAPTERS
// ============================================================================

export {
    registerEntityAdapter,
    getEntityAdapter,
    createEntityAdapter,
    createAndRegisterEntityAdapter,
} from "./adapters"
export type {CreateEntityAdapterOptions} from "./adapters"

// ============================================================================
// DELETE MODAL
// ============================================================================

export {
    // Components
    EntityDeleteModal,
    EntityDeleteTitle,
    EntityDeleteContent,
    EntityDeleteFooter,
    createDeleteHandler,
    // Hooks
    useEntityDelete,
    // State atoms
    deleteModalOpenAtom,
    deleteModalEntitiesAtom,
    deleteModalLoadingAtom,
    deleteModalErrorAtom,
    deleteModalGroupsAtom,
    deleteModalNamesAtom,
    deleteModalWarningsAtom,
    deleteModalBlockedAtom,
    deleteModalCanProceedAtom,
    deleteModalCountAtom,
    deleteModalStateAtom,
    resetDeleteModalAtom,
    openDeleteModalAtom,
    closeDeleteModalAtom,
    executeDeleteAtom,
} from "./delete"
export type {UseEntityDeleteReturn, DeleteEntitiesOptions} from "./delete"

// ============================================================================
// COMMIT MODAL
// ============================================================================

export {
    // Components
    EntityCommitModal,
    EntityCommitTitle,
    EntityCommitContent,
    EntityCommitFooter,
    AgentChangesSummary,
    // Hooks
    useEntityCommit,
    // State atoms
    commitModalOpenAtom,
    commitModalEntityAtom,
    commitModalMessageAtom,
    commitModalLoadingAtom,
    commitModalErrorAtom,
    commitModalEntityNameAtom,
    commitModalOriginalEntityNameAtom,
    commitModalCanCommitAtom,
    commitModalCanProceedAtom,
    commitModalContextAtom,
    commitModalStateAtom,
    resetCommitModalAtom,
    openCommitModalAtom,
    closeCommitModalAtom,
    setCommitMessageAtom,
    setCommitLoadingAtom,
    setCommitErrorAtom,
    executeCommitAtom,
} from "./commit"
export type {
    EntityCommitModalProps,
    CommitSubmitParams,
    CommitSubmitResult,
    CommitModeOption,
    CommitCreateFieldsConfig,
    AgentChangesSummaryProps,
    UseEntityCommitReturn,
} from "./commit"
export type {CommitDeployOption} from "./types"

// ============================================================================
// SAVE MODAL
// ============================================================================

export {
    // Components
    EntitySaveModal,
    EntitySaveTitle,
    EntitySaveContent,
    EntitySaveFooter,
    // Hooks
    useEntitySave,
    useTestsetSave,
    useVariantSave,
    // State atoms
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
    resetSaveModalAtom,
    openSaveModalAtom,
    openSaveNewModalAtom,
    closeSaveModalAtom,
    setSaveNameAtom,
    toggleSaveAsNewAtom,
    executeSaveAtom,
} from "./save"
export type {EntitySaveModalProps, UseEntitySaveReturn} from "./save"

// ============================================================================
// UNIFIED SAVE/COMMIT HOOK
// ============================================================================

export {useSaveOrCommit} from "./useSaveOrCommit"
export type {EntityState, SaveOrCommitOptions, UseSaveOrCommitReturn} from "./useSaveOrCommit"

// ============================================================================
// SHARED COMPONENTS & HOOK FACTORIES
// ============================================================================

export {EnhancedModal, type EnhancedModalProps, type EnhancedModalStyles} from "./shared"

// Hook factories for creating entity action hooks
export {
    createEntityActionHook,
    type CreateEntityActionHookConfig,
    type UseEntityActionReturn,
} from "./shared"

// ============================================================================
// UNIFIED ACTION DISPATCH
// ============================================================================

export {
    // Provider
    EntityActionProvider,
    // Hooks
    useEntityActionDispatch,
    useEntityActionState,
    useEntityActionGuard,
    // Reducer
    reduceEntityModalAction,
    // Action creators
    deleteAction,
} from "./actions"
export type {
    // Action types
    EntityModalAction,
    CommitAction,
    SaveAction,
    CreateAction,
    DeleteAction,
    SaveOrCommitAction,
    ActiveModal,
    EntityActionState,
    // Context types
    EntityActionDispatch,
    EntityActionContextValue,
    EntityActionProviderProps,
    EntityActionHelpers,
} from "./actions"

// ============================================================================
// COMBINED PROVIDER (recommended)
// ============================================================================

export {EntityModalsProvider, type EntityModalsProviderProps} from "./EntityActionProvider"

// ============================================================================
// PRESET MODAL
// ============================================================================

export {
    LoadEvaluatorPresetModal,
    type EvaluatorPreset,
    type LoadEvaluatorPresetModalProps,
} from "./preset"
