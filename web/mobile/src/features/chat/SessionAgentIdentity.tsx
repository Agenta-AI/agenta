import {memo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {AgentIdentity} from "@agenta/entity-ui/agent"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {LockSimpleIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {sharingCopy} from "@/lib/sharingCopy"

import {heldCommitAtomFamily} from "./selectedRevision"

/** The agent's icon, name and version status: in the session bar, or atop the config pane. */
const SessionAgentIdentityView = ({
    entityId,
    sessionId,
    agentId,
    agentHidden = false,
    onUpdate,
    autoUpdate = false,
    iconOnly = false,
}: {
    entityId: string | null
    sessionId: string
    agentId?: string | null
    agentHidden?: boolean
    onUpdate: (revisionId: string) => void
    autoUpdate?: boolean
    iconOnly?: boolean
}) => {
    // artifactName resolves from a revision id or a workflow id, so either handle names the agent.
    const name = useAtomValue(workflowMolecule.selectors.artifactName(entityId ?? agentId ?? ""))
    const agentName = agentHidden ? sharingCopy.privateAgent : name || "Agent"
    // A commit the session held back (unsaved config edits) is a reason to check for a newer
    // version now, so the status offers it at once.
    const heldCommit = useAtomValue(heldCommitAtomFamily(sessionId))

    if (agentHidden) {
        return (
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                <LockSimpleIcon size={14} aria-hidden className="shrink-0" />
                {agentName}
            </span>
        )
    }
    return (
        <>
            <AgentIdentity workflowId={agentId} name={agentName} iconOnly={iconOnly} />
            {entityId ? (
                <AgentRevisionStatus
                    revisionId={entityId}
                    historyWorkflowId={agentId}
                    onUpdate={onUpdate}
                    autoUpdate={autoUpdate}
                    checkKey={heldCommit ? `${sessionId}:${heldCommit}` : sessionId}
                    hideWhenSettled
                />
            ) : null}
        </>
    )
}

/** Memoized: the bar re-renders as it refits, and this part rarely changes. */
export const SessionAgentIdentity = memo(SessionAgentIdentityView)
