/**
 * SaveModeContent Component
 *
 * Handles the "save" mode of TestsetSelectionModal.
 * Allows saving local loadable data as a new testset.
 */

import {useCallback, useEffect} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {useSetAtom} from "jotai"

import {useSaveTestset} from "../hooks/useSaveTestset"

import {SaveTestsetPanel} from "./SaveTestsetPanel"

export interface SaveModeContentProps {
    loadableId: string
    defaultTestsetName?: string
    onSave?: (payload: {testsetId: string; revisionId: string; testsetName: string}) => void
    onCancel: () => void
}

export function SaveModeContent({
    loadableId,
    defaultTestsetName,
    onSave,
    onCancel,
}: SaveModeContentProps) {
    // Initialize name at entry point (once when save mode opens)
    // Note: This effect is acceptable here because:
    // 1. Modal content only renders when open (remounts on each open)
    // 2. This is one-time initialization, not ongoing sync
    // 3. The alternative (effect atoms) would be overkill for modal-scoped state
    const setName = useSetAtom(loadableController.actions.setName)
    useEffect(() => {
        if (defaultTestsetName) {
            setName(loadableId, defaultTestsetName)
        }
    }, [defaultTestsetName, loadableId, setName])

    const {saveTestset, isSaving} = useSaveTestset({
        loadableId,
        onSuccess: (payload) => {
            onSave?.(payload)
        },
    })

    const handleSaveConfirm = useCallback(
        async (commitMessage?: string) => {
            await saveTestset(commitMessage)
        },
        [saveTestset],
    )

    return (
        <SaveTestsetPanel
            loadableId={loadableId}
            onSave={handleSaveConfirm}
            onCancel={onCancel}
            isSaving={isSaving}
        />
    )
}
