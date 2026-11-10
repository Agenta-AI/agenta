import {workflowMolecule} from "@agenta/entities/workflow"
import {EditableRevisionDrawer} from "@agenta/playground-ui/panels/drawer"
import {useQueryClient} from "@tanstack/react-query"
import dynamic from "next/dynamic"

import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {PlaygroundFocusDrawerHost} from "../playground/PlaygroundFocusDrawerHost"
import {PlaygroundRunPane} from "../playground/PlaygroundRunPane"

// The tools section of a prompt opens the tool catalog; it loads when first opened.
const CatalogDrawer = dynamic(
    () => import("@agenta/entity-ui/gatewayTool").then((m) => m.CatalogDrawer),
    {ssr: false},
)

/**
 * The naming and create step of New prompt, as in /w: the editable revision drawer on the local
 * draft. The user can change and test the prompt, then Create names it and makes the app. The
 * page loads this file with `next/dynamic` and renders it only while a draft is open.
 */
export const CreatePromptDrawer = ({
    projectId,
    draftId,
    onClose,
    onCreated,
}: {
    projectId: string
    draftId: string
    onClose: () => void
    onCreated: (appId: string, revisionId: string) => void
}) => {
    const queryClient = useQueryClient()

    return (
        <DrillInBridgeProvider projectId={projectId}>
            <EditableRevisionDrawer
                revisionId={draftId}
                kind="variant"
                onClose={onClose}
                renderRuns={(id) => <PlaygroundRunPane revisionId={id} />}
                onCommitted={(_from, newRevisionId) => {
                    // The create primed the new revision, so its app id is known at once.
                    const appId = workflowMolecule.get.data(newRevisionId)?.workflow_id
                    // The Prompts list reads its own query; refresh it for a return to it.
                    void queryClient.invalidateQueries({queryKey: ["workflows"]})
                    if (appId) onCreated(appId, newRevisionId)
                }}
            />
            <CatalogDrawer />
            <PlaygroundFocusDrawerHost />
        </DrillInBridgeProvider>
    )
}
