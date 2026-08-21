import {useCallback} from "react"

import {isLatestRevisionAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {agentAutoCommitStatusAtomFamily, flushAgentAutoCommitAtom} from "@agenta/playground/state"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {SimpleTooltip} from "@agenta/ui/ui"
import {FloppyDiskBack} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

/**
 * The agent config header's Save — not the old Commit button.
 *
 * Config commits itself (#6126), so this appears only where auto-commit deliberately will not
 * act: a non-latest revision, a failed save, or a stranded draft. Commits directly, no modal.
 */
export const AgentSaveButton = ({revisionId}: {revisionId: string}) => {
    const id = revisionId || ""
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(id))
    const isAgent = useAtomValue(workflowMolecule.selectors.isAgent(id))
    const isLatest = useAtomValue(isLatestRevisionAtomFamily(id))
    const status = useAtomValue(agentAutoCommitStatusAtomFamily(id))
    const flushAutoCommit = useSetAtom(flushAgentAutoCommitAtom)

    const handleSave = useCallback(() => {
        if (!id) return
        void flushAutoCommit({revisionId: id, force: true})
    }, [flushAutoCommit, id])

    const failed = status === "error"
    const saving = status === "saving" || status === "pending"
    const stranded = isAgent && isLatest && isDirty && !saving && !failed
    if (!id || !(failed || stranded || (!isLatest && isDirty))) return null

    return (
        // Terse by design: the status dot in the page header carries the detail, including the
        // error message, so the button only has to name the action.
        <SimpleTooltip title={failed ? "Retry save" : isLatest ? "Save changes" : "Save as latest"}>
            <EnhancedButton
                size="small"
                type="primary"
                danger={failed}
                icon={<FloppyDiskBack size={14} />}
                loading={status === "saving"}
                onClick={handleSave}
            >
                Save
            </EnhancedButton>
        </SimpleTooltip>
    )
}
