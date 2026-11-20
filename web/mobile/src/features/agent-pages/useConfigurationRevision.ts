import {useEffect, useState} from "react"

import {
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
    // Hold the first latest revision the query answers with.
    useEffect(() => {
        if (pinned === null && latest) setPinned(latest)
    }, [latest, pinned])
    const revisionId = pinned ?? latest
    useEffect(
        () =>
            registerAgentAutoCommitHandler(`configuration-page:${agentId}`, (from, to) => {
                if (from === revisionId) setPinned(to)
            }),
        [agentId, revisionId],
    )
    // No revision once the lookup has settled: it failed, or found none.
    const failed = !revisionId && !query.isPending && !query.isFetching
    return {revisionId, pin: setPinned, failed, retry: () => void query.refetch()}
}
