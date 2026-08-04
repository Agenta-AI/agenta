import {useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

/**
 * The owning agent's name for a session row. Reads the workflow ARTIFACT's name — never a
 * revision's, which carries the variant label or nothing at all (see web/CLAUDE.md).
 */
const SessionAgentLabel = ({appId}: {appId: string | null}) => {
    const nameAtom = useMemo(() => workflowMolecule.selectors.artifactName(appId ?? ""), [appId])
    const name = useAtomValue(nameAtom)

    if (!appId) {
        return (
            <span className="text-xs text-colorTextTertiary" title="This session has no turns yet">
                No agent yet
            </span>
        )
    }

    return <span className="text-xs text-colorTextSecondary truncate">{name || "Agent"}</span>
}

export default SessionAgentLabel
