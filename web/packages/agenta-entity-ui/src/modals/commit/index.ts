/**
 * Entity Commit Modal
 *
 * Modal for committing entity changes (creating new revisions).
 */

// Components
export {
    EntityCommitModal,
    EntityCommitTitle,
    EntityCommitContent,
    EntityCommitFooter,
} from "./components"
export type {EntityCommitModalProps} from "./components"

// Hooks
export {useEntityCommit, useRevisionCommit, useVariantCommit, useBoundCommit} from "./hooks"
export type {UseEntityCommitReturn, UseBoundCommitOptions, UseBoundCommitReturn} from "./hooks"

// State atoms
export {
    // Core state
    commitModalOpenAtom,
    commitModalEntityAtom,
    commitModalMessageAtom,
    commitModalLoadingAtom,
    commitModalErrorAtom,
    // Derived state
    commitModalEntityNameAtom,
    commitModalCanCommitAtom,
    commitModalCanProceedAtom,
    commitModalContextAtom,
    commitModalStateAtom,
    // Actions
    resetCommitModalAtom,
    openCommitModalAtom,
    closeCommitModalAtom,
    setCommitMessageAtom,
    executeCommitAtom,
} from "./state"
