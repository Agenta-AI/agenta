import {useEffect, useState} from "react"

import {
    revalidateAgentRevisionReads,
    workflowLatestRevisionIdAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
} from "@agenta/entities/workflow"
import {registerAgentAutoCommitHandler} from "@agenta/playground/state"
import {useAtomValue} from "jotai"

/**
 * The revision the page edits: the agent's latest when the page opens, then held. It moves only
 * to the revision its own auto-save makes (the latest-revision query is stale for a beat after a
 * commit) or when the status's "Update to vN" asks (`pin`). A version saved elsewhere never
 * replaces it on its own, since an open drawer form may still edit the held one.
 */
export const useConfigurationRevision = (agentId: string) => {
    const latest = useAtomValue(workflowLatestRevisionIdAtomFamily(agentId))
    const query = useAtomValue(workflowLatestRevisionQueryAtomFamily(agentId))
    const [pinned, setPinned] = useState<string | null>(null)
    // Ask again on open: a save made while the page was closed invalidates the query without a
    // refetch, so its cached answer can be a superseded revision.
    useEffect(() => {
        revalidateAgentRevisionReads(agentId)
    }, [agentId])
    // Hold the first latest revision the query answers with once it has settled.
    useEffect(() => {
        if (pinned === null && latest && !query.isFetching) setPinned(latest)
    }, [latest, pinned, query.isFetching])
    // Nothing until held: a cached answer still being checked is not shown.
    const revisionId = pinned
    useEffect(
        () =>
            registerAgentAutoCommitHandler(`configuration-page:${agentId}`, (from, to) => {
                if (from === revisionId) setPinned(to)
            }),
        [agentId, revisionId],
    )
    // No revision once the lookup has settled: it failed, or found none.
    const failed = !revisionId && !latest && !query.isPending && !query.isFetching
    return {revisionId, pin: setPinned, failed, retry: () => void query.refetch()}
}
