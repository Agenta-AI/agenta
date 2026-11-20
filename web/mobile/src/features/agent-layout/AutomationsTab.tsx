import {useCallback} from "react"

import {AgentOperationsSections, type TriggerOwnerRef} from "@agenta/entity-ui/drill-in"
import {StorageFilesHeader, StorageSection} from "@agenta/entity-ui/drive"
import {useViewStack} from "@agenta/ui/view-stack"

import {automationRunHistoryView} from "../automations/automationRunHistoryView"
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
                    // The session workspace mounts the automation drawers.
                    automationDrawer={null}
                    onOpenRunHistory={openRunHistory}
                />
            </DrillInBridgeProvider>
        </div>
    )
}
