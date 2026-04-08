/**
 * TestsetSelectionModalContent Component
 *
 * Contains all data layer logic for the TestsetSelectionModal.
 * This component is only rendered when the modal is open, ensuring
 * that data subscriptions and processing only happen when needed.
 *
 * Supports two modes via the unified LoadModeContent:
 * - "load": Initial connection to a testset
 * - "edit": Modify selection of an already-connected testset
 *
 * For saving, use SaveTestsetModal instead.
 */

import type {TestsetSelectionModalContentProps} from "../types"

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
    canExportData,
    onCreateAndLoad,
}: TestsetSelectionModalContentProps) {
    return (
        <LoadModeContent
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
    )
}

export default TestsetSelectionModalContent
