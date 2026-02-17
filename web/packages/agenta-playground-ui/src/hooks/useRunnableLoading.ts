import {useMemo} from "react"

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {runnableBridge} from "@agenta/entities/runnable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {useAtomValue} from "jotai"

/**
 * Shared loading detection for a runnable entity.
 *
 * Returns true while the runnable query is pending or schema is loading.
 *
 * Local drafts that already have molecule data are treated as ready,
 * matching the pattern in LegacyPlaygroundConfigSection.
 *
 * Used by both completion and chat comparison cells.
 */
export function useRunnableLoading(entityId: string): boolean {
    const runnableQuery = useAtomValue(useMemo(() => runnableBridge.query(entityId), [entityId]))
    const requestPayload = useAtomValue(
        useMemo(() => runnableBridge.requestPayload(entityId), [entityId]),
    )
    const schemaLoading = useAtomValue(
        useMemo(() => legacyAppRevisionMolecule.atoms.schemaLoading(entityId), [entityId]),
    )
    const moleculeData = useAtomValue(
        useMemo(() => legacyAppRevisionMolecule.atoms.data(entityId), [entityId]),
    )

    // Local drafts with available molecule data are considered ready,
    // even if the runnable bridge query is still resolving source data.
    if (isLocalDraftId(entityId) && moleculeData) {
        return false
    }

    return runnableQuery.isPending || (requestPayload !== null && schemaLoading)
}
