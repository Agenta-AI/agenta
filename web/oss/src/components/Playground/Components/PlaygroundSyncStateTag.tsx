import {useCallback, useMemo} from "react"

import {loadableController} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {Tag} from "@agenta/ui"
import {useAtomValue, useSetAtom} from "jotai"

interface PlaygroundSyncStateTagProps {
    rowId: string
    loadableId: string
}

/**
 * Sync state tag slot — renders the sync state badge in each row header.
 * Shown only when connected to an API-backed testset.
 * - "new" (green): row was added locally and is not yet in the connected testset
 * - "modified" (blue): row has local edits not yet synced; shows discard × on hover
 * - "unmodified": no changes — nothing rendered
 */
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
        <Tag
            sync={syncState}
            dismissible={syncState === "modified"}
            onDismiss={syncState === "modified" ? handleDiscard : undefined}
        />
    )
}

export default PlaygroundSyncStateTag
