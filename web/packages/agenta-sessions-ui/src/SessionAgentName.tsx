import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

/**
 * The owning agent's name for a session row. Reads the workflow ARTIFACT's name — never a
 * revision's, which carries the variant label or nothing at all (see web/CLAUDE.md).
 */
export const SessionAgentName = ({agentId}: {agentId: string | null}) => {
    const nameAtom = useMemo(
        () => workflowMolecule.selectors.artifactName(agentId ?? ""),
        [agentId],
    )
    const name = useAtomValue(nameAtom)

    if (!agentId) {
        return (
            <span className="text-xs text-colorTextTertiary" title="This session has no turns yet">
                No agent yet
            </span>
        )
    }

    return <span className="text-xs text-colorTextSecondary truncate">{name || "Agent"}</span>
}
