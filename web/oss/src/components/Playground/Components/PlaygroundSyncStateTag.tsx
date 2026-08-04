import {useCallback, useMemo} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {SyncStateTag} from "@agenta/ui"
import {useAtomValue, useSetAtom} from "jotai"

interface PlaygroundSyncStateTagProps {
    rowId: string
    loadableId: string
}

export function PlaygroundSyncStateTag({rowId, loadableId}: PlaygroundSyncStateTagProps) {
    const mode = useAtomValue(loadableController.selectors.mode(loadableId)) as
        | "local"
        | "connected"
        | null
    const isDirty = useAtomValue(useMemo(() => testcaseMolecule.isDirty(rowId), [rowId])) as boolean
    const discard = useSetAtom(testcaseMolecule.actions.discard)

    const handleDiscard = useCallback(() => discard(rowId), [discard, rowId])

    // Only show sync tags when connected to an API-backed testset
    if (mode !== "connected") return null

    // New IDs are prefixed with "new-" or "local-" (established convention in the codebase)
    const isNew = rowId.startsWith("new-") || rowId.startsWith("local-")
    const syncState = isNew ? "new" : isDirty ? "modified" : "unmodified"

    return (
        <SyncStateTag
            syncState={syncState}
            dismissible={syncState === "modified"}
            onDismiss={syncState === "modified" ? handleDiscard : undefined}
        />
    )
}

export default PlaygroundSyncStateTag
