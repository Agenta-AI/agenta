import {isLocalDraftId} from "@agenta/entities/shared"
import {invalidateEvaluatorsListCache} from "@agenta/entities/workflow"
import {EditableRevisionDrawer} from "@agenta/playground-ui/panels/drawer"
import {ChainTokenPathProvider} from "@agenta/playground-ui/panels/evaluator"
import {message} from "@agenta/ui/app-message"
import {useQueryClient} from "@tanstack/react-query"

import {DrillInBridgeProvider} from "../../chat/DrillInBridgeProvider"
import {useProjectPermission} from "../../context/useProjectPermission"
import {LoadPresetAction} from "../../playground/LoadPresetAction"
import {PlaygroundFocusDrawerHost} from "../../playground/PlaygroundFocusDrawerHost"
import {evaluatorPlaygroundHref} from "../../playground/playgroundUrl"
import {usePlaygroundLeaveGuard} from "../../playground/usePlaygroundLeaveGuard"
import {OpenInPlaygroundButton} from "../../revisions/OpenInPlaygroundButton"

import {EvaluatorTestPane} from "./EvaluatorTestPane"

/**
 * An automatic evaluator in the shared editable drawer: its config, the test pane, and Commit, or
 * Create for a new evaluator made from a template (a `local-*` revision), which opens the naming
 * step. A page loads this file with `next/dynamic` and renders it only while a revision is open.
 */
export const EvaluatorEditorDrawer = ({
    projectId,
    revisionId,
    navigationIds,
    playgroundBase,
    onNavigate,
    onClose,
    onSaved,
    onPlayground = false,
}: {
    projectId: string
    revisionId: string
    navigationIds?: readonly string[]
    /** The project path, when the evaluator playground view is on: the header links to it. */
    playgroundBase: string | null
    onNavigate: (revisionId: string) => void
    onClose: () => void
    /** A Create or a Commit saved a revision: the host shows it. */
    onSaved: (revisionId: string) => void
    /** Opened over a page with its own playground: no test pane, and its state is left alone. */
    onPlayground?: boolean
}) => {
    const queryClient = useQueryClient()
    const canCommit = useProjectPermission(projectId, "edit_workflows")
    // A link out of the page (Open in playground) asks before unsaved edits are lost.
    const leaveDialog = usePlaygroundLeaveGuard()
    const local = isLocalDraftId(revisionId)

    return (
        <DrillInBridgeProvider projectId={projectId}>
            <ChainTokenPathProvider entityId={revisionId}>
                <EditableRevisionDrawer
                    revisionId={revisionId}
                    kind="evaluator"
                    navigationIds={navigationIds}
                    onNavigate={onNavigate}
                    onClose={onClose}
                    // A new evaluator opens with the test pane, as in /w.
                    defaultTesting={local && !onPlayground}
                    playground={!onPlayground}
                    canCommit={canCommit}
                    actions={
                        playgroundBase && !local ? (
                            <OpenInPlaygroundButton
                                href={evaluatorPlaygroundHref(playgroundBase, revisionId)}
                            />
                        ) : null
                    }
                    configActions={<LoadPresetAction revisionId={revisionId} />}
                    renderRuns={(id) => <EvaluatorTestPane revisionId={id} />}
                    onCommitted={(fromId, newId) => {
                        invalidateEvaluatorsListCache()
                        void queryClient.invalidateQueries({queryKey: ["workflows", "evaluators"]})
                        if (isLocalDraftId(fromId)) message.success("Evaluator created")
                        onSaved(newId)
                    }}
                />
            </ChainTokenPathProvider>
            <PlaygroundFocusDrawerHost />
            {leaveDialog}
        </DrillInBridgeProvider>
    )
}
