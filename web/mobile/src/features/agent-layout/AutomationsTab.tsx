import {useCallback} from "react"

import {
    AgentOperationsSections,
    type AutomationAddKind,
    type TriggerOwnerRef,
} from "@agenta/entity-ui/drill-in"
import {StorageFilesHeader, StorageSection} from "@agenta/entity-ui/drive"
import {useViewStack} from "@agenta/ui/view-stack"

import {automationRunHistoryView} from "../automations/automationRunHistoryView"
import {automationNewView, automationView} from "../automations/automationView"
import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {useProjectPermissionState} from "../context/useProjectPermission"

/** The Automations tab: the agent's automations and its recent files, as production shows them. */
export const AutomationsTab = ({
    revisionId,
    workspaceId,
    sessionId,
    filesScope,
    projectId,
}: {
    revisionId: string
    workspaceId: string
    sessionId: string
    filesScope: string
    projectId: string
}) => {
    const editAccess = useProjectPermissionState(projectId, "edit_workflows")
    const stack = useViewStack()
    // The run history opens in the panel, as a view.
    const openRunHistory = useCallback(
        ({id, kind}: TriggerOwnerRef) =>
            void stack.open(
                automationRunHistoryView,
                {
                    automationId: id,
                    kind: kind === "schedule" ? "schedule" : "event",
                    workspaceId,
                    projectId,
                },
                {kind: "project"},
            ),
        [projectId, stack, workspaceId],
    )
    // The automation and its create forms open in the panel as views, not drawers.
    const openAutomation = useCallback(
        ({id, kind}: TriggerOwnerRef) =>
            void stack.open(
                automationView,
                {
                    automationId: id,
                    kind: kind === "schedule" ? ("schedule" as const) : ("event" as const),
                    workspaceId,
                    projectId,
                },
                {kind: "project"},
            ),
        [projectId, stack, workspaceId],
    )
    const addAutomation = useCallback(
        (kind: AutomationAddKind, references: Record<string, {id?: string; slug?: string}>) =>
            void stack.open(automationNewView, {kind, revisionId, references}, {kind: "project"}),
        [revisionId, stack],
    )
    return (
        <div className="ag-scroll-no-bar h-full min-h-0 overflow-y-auto">
            <DrillInBridgeProvider projectId={projectId}>
                <AgentOperationsSections
                    revisionId={revisionId}
                    disabled={!editAccess.pending && !editAccess.allowed}
                    sticky={false}
                    storage={
                        <StorageSection
                            revisionId={revisionId}
                            sessionId={sessionId}
                            scope={filesScope}
                        />
                    }
                    storageHeader={
                        <StorageFilesHeader
                            revisionId={revisionId}
                            sessionId={sessionId}
                            scope={filesScope}
                        />
                    }
                    // The automations open as views; the session workspace still mounts the
                    // automation drawers for its other openers.
                    automationDrawer={null}
                    onOpenRunHistory={openRunHistory}
                    onOpenAutomation={openAutomation}
                    onAddAutomation={addAutomation}
                />
            </DrillInBridgeProvider>
        </div>
    )
}
