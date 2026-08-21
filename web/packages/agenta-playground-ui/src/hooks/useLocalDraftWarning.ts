import {useEffect, useMemo} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {isLatestRevisionAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {playgroundController} from "@agenta/playground"
import {agentAutoCommitStatusAtomFamily} from "@agenta/playground/state"
import {atom, useAtomValue} from "jotai"

/**
 * Warn before leaving only when leaving actually loses work.
 *
 * Agent config on the latest revision saves itself (#6126), so an ordinary dirty agent is not
 * at risk and must not prompt. What still is: a local draft or ephemeral entity, a dirty OLDER
 * revision (manual save by design), a non-agent entity (the classic playground is unchanged),
 * and any agent whose save has not landed yet — failed, or still parked behind a running turn.
 */
export const useLocalDraftWarning = () => {
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))

    const hasUnsavedOrLocalDraftsAtom = useMemo(
        () =>
            atom((get) =>
                nodes
                    .filter((n) => n.depth === 0)
                    .some((node) => {
                        const {entityId} = node
                        if (isLocalDraftId(entityId)) return true
                        if (!get(workflowMolecule.selectors.isDirty(entityId))) return false
                        if (!get(workflowMolecule.selectors.isAgent(entityId))) return true
                        if (get(workflowMolecule.selectors.isEphemeral(entityId))) return true

                        // A save that failed, or one parked behind a running turn, is unsaved
                        // work — "pending" is exactly the at-risk state, not just "error".
                        const status = get(agentAutoCommitStatusAtomFamily(entityId))
                        if (status === "error" || status === "pending") return true

                        // Dirty on an older revision: nothing will save it but the user.
                        return !get(isLatestRevisionAtomFamily(entityId))
                    }),
            ),
        [nodes],
    )

    const hasUnsavedOrLocalDrafts = useAtomValue(hasUnsavedOrLocalDraftsAtom)

    useEffect(() => {
        if (!hasUnsavedOrLocalDrafts) return

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            const message =
                "You have local draft revisions or unsaved changes that will be lost if you leave. Are you sure you want to continue?"
            e.preventDefault()
            e.returnValue = message
            return message
        }

        window.addEventListener("beforeunload", handleBeforeUnload)

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload)
        }
    }, [hasUnsavedOrLocalDrafts])
}
