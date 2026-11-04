import {useCallback} from "react"

import {automationRunHistoryDrawerAtom} from "@agenta/automation-ui"
import {ModelSetupBanner} from "@agenta/chat/components"
import type {TriggerOwnerRef} from "@agenta/entity-ui/drill-in"
import {StorageFilesHeader, StorageSection} from "@agenta/entity-ui/drive"
import {AgentBuildPanel} from "@agenta/playground-ui/agent-build"
import {useSetAtom} from "jotai"

import {useProjectPermissionState} from "../context/useProjectPermission"

import {DrillInBridgeProvider} from "./DrillInBridgeProvider"
import {selectedRevisionAtomFamily} from "./selectedRevision"
import {useOpenModelSetup} from "./useOpenModelSetup"

/**
 * Build's left pane: the SHARED config panel with the SHARED Files region.
 *
 * The drive is session-scoped, so the session is passed straight in: this surface already knows
 * which conversation it is (the desktop has to resolve it from its open tabs instead).
 */
export const ConfigPane = ({
    entityId,
    sessionId,
    filesScope,
    projectId,
}: {
    entityId: string
    sessionId: string
    filesScope: string
    projectId: string
}) => {
    const openModelSetup = useOpenModelSetup()
    // A commit made here pins the new revision to this session.
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(sessionId))
    // A row's "Run history" opens in a drawer over the agent, like the automation editor does,
    // rather than navigating away from the conversation.
    const openDrawer = useSetAtom(automationRunHistoryDrawerAtom)
    // The API refuses a Viewer's edits; this keeps the editor from offering them. The editor stays
    // open while the check is in flight, so the people who may edit do not see it lock and unlock.
    const editAccess = useProjectPermissionState(projectId, "edit_workflows")
    const openRunHistory = useCallback(
        ({id, kind}: TriggerOwnerRef) => {
            openDrawer({automationId: id, kind: kind === "schedule" ? "schedule" : "event"})
        },
        [openDrawer],
    )

    return (
        <div className="ag-panel-raised ag-scroll-no-bar flex h-full min-h-0 w-full flex-col overflow-y-auto">
            <DrillInBridgeProvider projectId={projectId} onWorkflowRevisionCommitted={pinRevision}>
                <AgentBuildPanel
                    revisionId={entityId}
                    disabled={!editAccess.pending && !editAccess.allowed}
                    stickyHeaderTop={0}
                    banner={
                        <div className="px-4">
                            <ModelSetupBanner
                                revisionId={entityId}
                                layout="alert"
                                onSetUp={openModelSetup}
                            />
                        </div>
                    }
                    storage={
                        <StorageSection
                            revisionId={entityId}
                            sessionId={sessionId}
                            scope={filesScope}
                        />
                    }
                    storageHeader={
                        <StorageFilesHeader
                            revisionId={entityId}
                            sessionId={sessionId}
                            scope={filesScope}
                        />
                    }
                    // `SessionWorkspace` mounts the drawers: a linked one must open with this pane collapsed.
                    automationDrawer={null}
                    onOpenRunHistory={openRunHistory}
                />
            </DrillInBridgeProvider>
        </div>
    )
}
