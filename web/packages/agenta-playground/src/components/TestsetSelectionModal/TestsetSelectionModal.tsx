/**
 * TestsetSelectionModal Component
 *
 * Modal for selecting testcases from a testset revision or saving local data.
 * Uses entity-layer atoms for selection state, supporting:
 * - "load" mode: Initial connection to a testset
 * - "edit" mode: Modify selection of an already-connected testset
 * - "save" mode: Save local loadable data as a new testset
 *
 * Architecture:
 * - This component is a thin wrapper that handles modal chrome (title, size, open state)
 * - All data layer logic is in TestsetSelectionModalContent, which only renders when open
 * - This ensures data subscriptions and processing only happen when the modal is visible
 *
 * Key difference from OSS LoadTestsetModal:
 * - Selection state lives in entity layer (testcaseMolecule.atoms.selectionDraft)
 * - Selection persists and can be edited after connection
 * - No modal-local atoms that get lost on close
 * - Save mode reads directly from loadable entity - no data copying
 */

import {EnhancedModal, modalSizes} from "@agenta/ui"

import {TestsetSelectionModalContent} from "./components/TestsetSelectionModalContent"
import type {TestsetSelectionModalProps} from "./types"

// ============================================================================
// MODAL SIZE CONFIGURATION
// Uses modalSizes from @agenta/ui with mode-specific overrides
// ============================================================================

const MODAL_SIZES = {
    save: {width: 900, height: modalSizes.medium.height},
    edit: {width: modalSizes.medium.width, height: modalSizes.large.height},
    load: {width: modalSizes.large.width, height: "70dvh"},
} as const

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TestsetSelectionModal({
    loadableId,
    connectedRevisionId,
    mode,
    onConfirm,
    onSave,
    onCancel,
    open,
    defaultTestsetName,
    ...modalProps
}: TestsetSelectionModalProps) {
    const modalTitle =
        mode === "save"
            ? "Create Testset"
            : mode === "load"
              ? "Load Testset"
              : "Edit Testcase Selection"

    const {width, height} = MODAL_SIZES[mode]

    return (
        <EnhancedModal
            {...modalProps}
            open={open}
            title={modalTitle}
            width={width}
            onCancel={onCancel}
            footer={null}
            styles={{
                body: {
                    height,
                    maxHeight: height,
                    padding: 0,
                    overflow: "hidden",
                    flex: "none",
                },
            }}
        >
            <TestsetSelectionModalContent
                loadableId={loadableId}
                connectedRevisionId={connectedRevisionId}
                mode={mode}
                onConfirm={onConfirm}
                onSave={onSave}
                onCancel={onCancel}
                defaultTestsetName={defaultTestsetName}
            />
        </EnhancedModal>
    )
}

export default TestsetSelectionModal
