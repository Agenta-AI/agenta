/**
 * TestsetSelectionModal Component
 *
 * Modal for selecting testcases from a testset revision.
 * Uses entity-layer atoms for selection state, supporting:
 * - "load" mode: Initial connection to a testset
 * - "edit" mode: Modify selection of an already-connected testset
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

import {modalSizes} from "@agenta/ui/styles"
import {Dialog, DialogContent, DialogHeader, DialogTitle} from "@agenta/ui/ui"

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
    connectedTestsetId,
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
}: TestsetSelectionModalProps) {
    const modalTitle = mode === "load" ? "Load Testset" : "Edit Testcase Selection"
    const {width} = MODAL_SIZES[mode]

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
            <DialogContent style={{maxWidth: width}}>
                <DialogHeader>
                    <DialogTitle>{modalTitle}</DialogTitle>
                </DialogHeader>
                <div className="h-155 min-h-0 flex-auto overflow-hidden">
                    <TestsetSelectionModalContent
                        loadableId={loadableId}
                        connectedTestsetId={connectedTestsetId}
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
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default TestsetSelectionModal
