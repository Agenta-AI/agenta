/**
 * TestsetSelectionModal Component
 *
 * Modal for selecting testcases from a testset revision.
 * Uses entity-layer atoms for selection state, supporting:
 * - "load" mode: Initial connection to a testset
 * - "edit" mode: Modify selection of an already-connected testset
 *
 * For saving local data as a new testset, use SaveTestsetModal instead.
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
 */

import {EnhancedModal} from "@agenta/ui/components/modal"
import {modalSizes} from "@agenta/ui/styles"

import {TestsetSelectionModalContent} from "./components/TestsetSelectionModalContent"
import type {TestsetSelectionModalProps} from "./types"

// ============================================================================
// MODAL SIZE CONFIGURATION
// Uses modalSizes from @agenta/ui with mode-specific overrides
// ============================================================================

const MODAL_SIZES = {
    edit: {width: modalSizes.large.width, height: modalSizes.large.height},
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
    onCancel,
    open,
    selectionMode,
    renderCreateCard,
    renderPreviewPanel,
    warningMessage,
    hasWarning,
    canExportData,
    onCreateAndLoad,
    ...modalProps
}: TestsetSelectionModalProps) {
    const modalTitle = mode === "load" ? "Load Testset" : "Edit Testcase Selection"
    const {width} = MODAL_SIZES[mode]

    return (
        <EnhancedModal
            {...modalProps}
            open={open}
            title={modalTitle}
            width={width}
            onCancel={onCancel}
            footer={null}
            classNames={{body: "!p-0"}}
            styles={{
                body: {
                    flex: "1 1 auto",
                    height: 620,
                    padding: 0,
                    overflow: "hidden",
                },
            }}
        >
            <TestsetSelectionModalContent
                loadableId={loadableId}
                connectedRevisionId={connectedRevisionId}
                mode={mode}
                onConfirm={onConfirm}
                onCancel={onCancel}
                selectionMode={selectionMode}
                renderCreateCard={renderCreateCard}
                renderPreviewPanel={renderPreviewPanel}
                warningMessage={warningMessage}
                hasWarning={hasWarning}
                canExportData={canExportData}
                onCreateAndLoad={onCreateAndLoad}
            />
        </EnhancedModal>
    )
}

export default TestsetSelectionModal
