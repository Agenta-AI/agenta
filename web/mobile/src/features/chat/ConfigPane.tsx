import {ModelSetupBanner} from "@agenta/chat/components"
import {AgentBuildPanel} from "@agenta/playground-ui/agent-build"
import {AgentConfigHeader} from "@agenta/playground-ui/agent-config-header"
import {useSetAtom} from "jotai"

import {useProjectPermissionState} from "../context/useProjectPermission"

import {DrillInBridgeProvider} from "./DrillInBridgeProvider"
import {selectedRevisionAtomFamily} from "./selectedRevision"
import {useOpenModelSetup} from "./useOpenModelSetup"

/**
 * Build's left pane: the SHARED config panel under the SHARED "Configuration" header, with the
 * SHARED Files region — the same three components the desktop playground renders.
 *
 * The drive is session-scoped, so the session is passed straight in: this surface already knows
 * which conversation it is (the desktop has to resolve it from its open tabs instead).
 *
 * Deploy and the overflow menu are absent, not reproduced: both still read this app's app-layer
 * state on the desktop side, and the header takes them as slots precisely so a surface that
 * cannot offer them simply does not.
 */
export const ConfigPane = ({
    entityId,
    sessionId,
    projectId,
}: {
    entityId: string
    sessionId: string
    projectId: string
}) => {
    const openModelSetup = useOpenModelSetup()
    // A commit made here pins the new revision to this session.
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(sessionId))
    // The API refuses a Viewer's edits; this keeps the editor from offering them. The editor stays
    // open while the check is in flight, so the people who may edit do not see it lock and unlock.
    const editAccess = useProjectPermissionState(projectId, "edit_workflows")

    return (
        <div className="ag-panel-raised ag-scroll-no-bar flex h-full min-h-0 w-full flex-col overflow-y-auto">
            <DrillInBridgeProvider projectId={projectId} onWorkflowRevisionCommitted={pinRevision}>
                <AgentBuildPanel
                    revisionId={entityId}
                    disabled={!editAccess.pending && !editAccess.allowed}
                    // Automations and files have their own places in the panel.
                    operations={false}
                    stickyHeaderTop={48}
                    banner={
                        <div className="px-4">
                            <ModelSetupBanner
                                revisionId={entityId}
                                layout="alert"
                                onSetUp={openModelSetup}
                            />
                        </div>
                    }
                    // The operational sections (and their drawers) live in the Automations tab.
                    automationDrawer={null}
                    header={
                        <AgentConfigHeader
                            revisionId={entityId}
                            // `/m` mounts the auto-commit engine, so this header shows Save
                            // rather than Commit. The desktop playground keeps Commit.
                            autoSave
                        />
                    }
                />
            </DrillInBridgeProvider>
        </div>
    )
}
