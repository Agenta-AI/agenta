/**
 * TestsetSelectionModalContent Component
 *
 * Contains all data layer logic for the TestsetSelectionModal.
 * This component is only rendered when the modal is open, ensuring
 * that data subscriptions and processing only happen when needed.
 *
 * Supports two modes:
 * - "load": Initial connection to a testset
 * - "edit": Modify selection of an already-connected testset
 *
 * For saving, use SaveTestsetModal instead.
 */

import type {TestsetSelectionModalContentProps} from "../types"

import {EditModeContent} from "./EditModeContent"
import {LoadModeContent} from "./LoadModeContent"

export function TestsetSelectionModalContent({
    loadableId,
    connectedRevisionId,
    mode,
    onConfirm,
    onCancel,
    selectionMode,
    renderCreateCard,
    renderPreviewPanel,
    warningMessage,
    hasWarning,
    onCreateAndLoad,
}: TestsetSelectionModalContentProps) {
    if (mode === "edit") {
        return (
            <EditModeContent
                loadableId={loadableId}
                connectedRevisionId={connectedRevisionId}
                onConfirm={onConfirm}
                onCancel={onCancel}
            />
        )
    }

    // Load mode
    return (
        <LoadModeContent
            loadableId={loadableId}
            connectedRevisionId={connectedRevisionId}
            onConfirm={onConfirm}
            onCancel={onCancel}
            selectionMode={selectionMode}
            renderCreateCard={renderCreateCard}
            renderPreviewPanel={renderPreviewPanel}
            warningMessage={warningMessage}
            hasWarning={hasWarning}
            onCreateAndLoad={onCreateAndLoad}
        />
    )
}

export default TestsetSelectionModalContent
