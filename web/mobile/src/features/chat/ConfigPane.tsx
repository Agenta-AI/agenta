import {invalidateWorkflowsListCache} from "@agenta/entities/workflow"
import {StorageFilesHeader, StorageSection} from "@agenta/entity-ui/drive"
import {AgentBuildPanel} from "@agenta/playground-ui/agent-build"
import {AgentConfigHeader} from "@agenta/playground-ui/agent-config-header"
import {useSetAtom} from "jotai"

import {DrillInBridgeProvider} from "./DrillInBridgeProvider"
import {selectedRevisionAtomFamily} from "./selectedRevision"

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
    agentId,
    sessionId,
}: {
    entityId: string
    agentId?: string | null
    sessionId: string
}) => {
    const pinRevision = useSetAtom(selectedRevisionAtomFamily(sessionId))
    return (
        <div className="ag-panel-raised ag-scroll-no-bar flex h-full min-h-0 w-full flex-col overflow-y-auto">
            <DrillInBridgeProvider>
                <AgentBuildPanel
                    revisionId={entityId}
                    stickyHeaderTop={48}
                    storage={<StorageSection revisionId={entityId} sessionId={sessionId} />}
                    storageHeader={
                        <StorageFilesHeader revisionId={entityId} sessionId={sessionId} />
                    }
                    header={
                        <AgentConfigHeader
                            revisionId={entityId}
                            appId={agentId ?? undefined}
                            // The roster and the agent screens read the workflows list query; a
                            // commit mints a revision they would otherwise not see.
                            // A commit mints a revision: drop any pin so the workspace follows the
                            // new latest instead of staying on the one that was just committed
                            // from. The list query the roster and agent screens read needs the
                            // same nudge.
                            onAfterCommit={() => {
                                pinRevision(null)
                                void invalidateWorkflowsListCache()
                            }}
                        />
                    }
                />
            </DrillInBridgeProvider>
        </div>
    )
}
