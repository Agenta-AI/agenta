/**
 * TestsetSelectionModalContent Component
 *
 * Contains all data layer logic for the TestsetSelectionModal.
 * This component is only rendered when the modal is open, ensuring
 * that data subscriptions and processing only happen when needed.
 *
 * Supports three modes:
 * - "load": Initial connection to a testset
 * - "edit": Modify selection of an already-connected testset
 * - "save": Save local loadable data as a new testset
 */

import type {TestsetSelectionModalContentProps} from "../types"

import {EditModeContent} from "./EditModeContent"
import {LoadModeContent} from "./LoadModeContent"
import {SaveModeContent} from "./SaveModeContent"

export function TestsetSelectionModalContent({
    loadableId,
    connectedRevisionId,
    mode,
    onConfirm,
    onSave,
    onCancel,
    defaultTestsetName,
}: TestsetSelectionModalContentProps) {
    if (mode === "save") {
        return (
            <SaveModeContent
                loadableId={loadableId}
                defaultTestsetName={defaultTestsetName}
                onSave={onSave}
                onCancel={onCancel}
            />
        )
    }

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
        />
    )
}

export default TestsetSelectionModalContent
