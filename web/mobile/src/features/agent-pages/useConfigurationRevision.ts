import {useCallback, useEffect, useRef, useState} from "react"

import {workflowLatestRevisionQueryAtomFamily} from "@agenta/entities/workflow"
import {registerAgentAutoCommitHandler} from "@agenta/playground/state"
import {useAtomValue} from "jotai"

/**
 * The revision the page edits: the agent's latest, asked from the server when the page opens
 * (a cached answer can be a superseded revision), then held. It moves only to the revision its
 * own auto-save makes (the latest-revision query is stale for a beat after a commit) or when the
 * status's "Update to vN" asks (`pin`). A version saved elsewhere never replaces it on its own,
 * since an open drawer form may still edit the held one.
 */
export const useConfigurationRevision = (agentId: string) => {
    const query = useAtomValue(workflowLatestRevisionQueryAtomFamily(agentId))
    const [pinned, setPinned] = useState<string | null>(null)
    const [failed, setFailed] = useState(false)
    const refetch = useRef(query.refetch)
    useEffect(() => {
        refetch.current = query.refetch
    }, [query.refetch])

    /** Asks for the latest revision and holds it, unless one is held already. */
    const open = useCallback(() => {
        let alive = true
        setFailed(false)
        refetch.current().then(
            (result) => {
                if (!alive) return
                // A failed request keeps the cached data; only a confirmed answer is held.
                const id = result.isError ? null : (result.data?.id ?? null)
                if (id) setPinned((held) => held ?? id)
                else setFailed(true)
            },
            () => {
                if (alive) setFailed(true)
            },
        )
        return () => {
            alive = false
        }
    }, [])
    useEffect(() => open(), [agentId, open])

    useEffect(
        () =>
            registerAgentAutoCommitHandler(`configuration-page:${agentId}`, (from, to) => {
                if (from === pinned) setPinned(to)
            }),
        [agentId, pinned],
    )
    return {
        revisionId: pinned,
        pin: setPinned,
        // The lookup settled with no revision: it failed, or found none.
        failed: !pinned && failed,
        retry: () => void open(),
    }
}
