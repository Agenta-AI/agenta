/**
 * Entity Save Modal
 *
 * Modal for saving entities or creating new ones.
 */

// Components
export {EntitySaveModal, EntitySaveTitle, EntitySaveContent, EntitySaveFooter} from "./components"
export type {EntitySaveModalProps} from "./components"

// Hooks
export {useEntitySave, useTestsetSave, useVariantSave} from "./hooks"
export type {UseEntitySaveReturn} from "./hooks"

// State atoms
export {
    // Core state
    saveModalOpenAtom,
    saveModalEntityAtom,
    saveModalEntityTypeAtom,
    saveModalNameAtom,
    saveModalSaveAsNewAtom,
    saveModalLoadingAtom,
    saveModalErrorAtom,
    // Derived state
    saveModalResolvedTypeAtom,
    saveModalOriginalNameAtom,
    saveModalNameModifiedAtom,
    saveModalCanProceedAtom,
    saveModalTitleAtom,
    saveModalStateAtom,
    // Actions
    resetSaveModalAtom,
    openSaveModalAtom,
    openSaveNewModalAtom,
    closeSaveModalAtom,
    setSaveNameAtom,
    toggleSaveAsNewAtom,
    executeSaveAtom,
} from "./state"
