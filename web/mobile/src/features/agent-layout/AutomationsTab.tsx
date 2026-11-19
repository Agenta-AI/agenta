import {useCallback} from "react"

import {automationRunHistoryDrawerAtom} from "@agenta/automation-ui/run-history-drawer-atom"
import {AgentOperationsSections, type TriggerOwnerRef} from "@agenta/entity-ui/drill-in"
import {StorageFilesHeader, StorageSection} from "@agenta/entity-ui/drive"
import {useSetAtom} from "jotai"

import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {useProjectPermissionState} from "../context/useProjectPermission"

/** The Automations tab: the agent's automations and its recent files, as production shows them. */
export const AutomationsTab = ({
    revisionId,
    sessionId,
    filesScope,
    projectId,
}: {
    revisionId: string
    sessionId: string
    filesScope: string
    projectId: string
}) => {
    const editAccess = useProjectPermissionState(projectId, "edit_workflows")
    const openDrawer = useSetAtom(automationRunHistoryDrawerAtom)
    const openRunHistory = useCallback(
        ({id, kind}: TriggerOwnerRef) =>
            openDrawer({automationId: id, kind: kind === "schedule" ? "schedule" : "event"}),
        [openDrawer],
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
