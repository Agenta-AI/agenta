import {useEffect, useState} from "react"

import {workflowLatestRevisionIdAtomFamily} from "@agenta/entities/workflow"
import {registerAgentAutoCommitHandler} from "@agenta/playground/state"
import {useAtomValue} from "jotai"

/**
 * The agent's latest revision, pinned to the one an auto-save made from it: the latest-revision
 * query is stale for a beat after a commit, and the page must not step back to the old one.
 */
export const useConfigurationRevision = (agentId: string) => {
    const latest = useAtomValue(workflowLatestRevisionIdAtomFamily(agentId))
    const [pinned, setPinned] = useState<string | null>(null)
    const revisionId = pinned ?? latest
    useEffect(
        () =>
            registerAgentAutoCommitHandler(`configuration-page:${agentId}`, (from, to) => {
                if (from === revisionId) setPinned(to)
            }),
        [agentId, revisionId],
    )
    return {revisionId, pin: setPinned}
}
