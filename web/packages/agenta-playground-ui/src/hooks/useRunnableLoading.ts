import {useMemo} from "react"

import {runnableBridge} from "@agenta/entities/runnable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {useAtomValue} from "jotai"

/**
 * Shared loading detection for a runnable entity.
 *
 * Returns true while the runnable query is pending.
 *
 * Local drafts that already have bridge data are treated as ready,
 * matching the pattern in PlaygroundConfigSection (@agenta/entity-ui).
 *
 * Used by both completion and chat comparison cells.
 */
export function useRunnableLoading(entityId: string): boolean {
    const runnableQuery = useAtomValue(useMemo(() => runnableBridge.query(entityId), [entityId]))
    const runnableData = useAtomValue(useMemo(() => runnableBridge.data(entityId), [entityId]))

    // Local drafts with available bridge data are considered ready,
    // even if the runnable bridge query is still resolving source data.
    if (isLocalDraftId(entityId) && runnableData) {
        return false
    }

    return runnableQuery.isPending
}
