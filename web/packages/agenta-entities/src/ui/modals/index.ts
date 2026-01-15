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
 * } from '@agenta/entities/ui/modals'
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
    DeleteModalState,
    EntityDeleteModalProps,
    CommitModalState,
    SaveModalState,
} from "./types"

export {groupEntitiesByType, getEntityTypeLabel} from "./types"

// ============================================================================
// ADAPTERS
// ============================================================================

export {
    registerEntityAdapter,
    getEntityAdapter,
    hasEntityAdapter,
    getRegisteredEntityTypes,
    clearAdapterRegistry,
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
    useTestsetDelete,
    useVariantDelete,
    useEvaluatorDelete,
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
    // Hooks
    useEntityCommit,
    useRevisionCommit,
    useVariantCommit,
    useBoundCommit,
    // State atoms
    commitModalOpenAtom,
    commitModalEntityAtom,
    commitModalMessageAtom,
    commitModalLoadingAtom,
    commitModalErrorAtom,
    commitModalEntityNameAtom,
    commitModalCanCommitAtom,
    commitModalCanProceedAtom,
    commitModalContextAtom,
    commitModalStateAtom,
    resetCommitModalAtom,
    openCommitModalAtom,
    closeCommitModalAtom,
    setCommitMessageAtom,
    executeCommitAtom,
} from "./commit"
export type {
    EntityCommitModalProps,
    UseEntityCommitReturn,
    UseBoundCommitOptions,
    UseBoundCommitReturn,
} from "./commit"

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

export {
    useSaveOrCommit,
    createBoundSaveOrCommit,
    getSaveOrCommitLabel,
    getSaveOrCommitIconName,
} from "./useSaveOrCommit"
export type {EntityState, SaveOrCommitOptions, UseSaveOrCommitReturn} from "./useSaveOrCommit"

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

export {EnhancedModal, type EnhancedModalProps, type EnhancedModalStyles} from "./shared"
