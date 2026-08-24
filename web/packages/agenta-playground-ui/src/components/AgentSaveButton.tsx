import {useCallback} from "react"

import {isLatestRevisionAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {agentAutoCommitStatusAtomFamily, flushAgentAutoCommitAtom} from "@agenta/playground/state"
import {agentAutoCommitHeldAtomFamily} from "@agenta/shared/state"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {SimpleTooltip} from "@agenta/ui/ui"
import {FloppyDiskBack} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

/**
 * The agent config header's Save — not the old Commit button.
 *
 * Config commits itself (#6126), so most of the time this has nothing to do. It stays visible on
 * every agent revision anyway, latest or older, so the manual path is always in the same place
 * rather than appearing only in the states where auto-commit steps aside. It disables itself when
 * there is nothing to save, and while a run owns the revision (a click would only defer, since
 * committing under the agent would fail its own commit_revision). Commits directly, no modal.
 */
export const AgentSaveButton = ({revisionId}: {revisionId: string}) => {
    const id = revisionId || ""
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(id))
    const isAgent = useAtomValue(workflowMolecule.selectors.isAgent(id))
    const isLatest = useAtomValue(isLatestRevisionAtomFamily(id))
    const status = useAtomValue(agentAutoCommitStatusAtomFamily(id))
    const held = useAtomValue(agentAutoCommitHeldAtomFamily(id))
    const flushAutoCommit = useSetAtom(flushAgentAutoCommitAtom)

    const handleSave = useCallback(() => {
        if (!id) return
        void flushAutoCommit({revisionId: id, force: true})
    }, [flushAutoCommit, id])

    if (!id || !isAgent) return null

    const failed = status === "error"
    const nothingToSave = !isDirty && !failed
    const disabled = nothingToSave || held

    // Terse by design: the status dot in the page header carries the detail, including the error
    // message, so the button only has to name the action.
    const tip = failed
        ? "Retry save"
        : nothingToSave
          ? "No changes to save"
          : held
            ? "Saving when this run finishes"
            : isLatest
              ? "Save changes"
              : "Save as latest"

    return (
        <SimpleTooltip title={tip}>
            <EnhancedButton
                size="small"
                type="primary"
                danger={failed}
                disabled={disabled}
                icon={<FloppyDiskBack size={14} />}
                loading={status === "saving"}
                onClick={handleSave}
            >
                Save
            </EnhancedButton>
        </SimpleTooltip>
    )
}
