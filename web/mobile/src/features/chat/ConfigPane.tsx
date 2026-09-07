import {configPanelCollapsedAtom} from "@agenta/chat/state"
import {StorageFilesHeader, StorageSection} from "@agenta/entity-ui/drive"
import {AgentBuildPanel} from "@agenta/playground-ui/agent-build"
import {AgentConfigHeader} from "@agenta/playground-ui/agent-config-header"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"
import {ChevronsLeft} from "lucide-react"

import {DrillInBridgeProvider} from "./DrillInBridgeProvider"

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
    const setConfigCollapsed = useSetAtom(configPanelCollapsedAtom)

    return (
        <div className="ag-panel-raised ag-scroll-no-bar flex h-full min-h-0 w-full flex-col overflow-y-auto">
            <DrillInBridgeProvider sessionId={sessionId} projectId={projectId}>
                <AgentBuildPanel
                    revisionId={entityId}
                    stickyHeaderTop={48}
                    storage={
                        <StorageSection
                            revisionId={entityId}
                            sessionId={sessionId}
                            // Mobile shows one conversation at a time, so the session IS the
                            // pane scope (desktop keys it by chat panel, which has tabs).
                            scope={sessionId}
                        />
                    }
                    storageHeader={
                        <StorageFilesHeader revisionId={entityId} sessionId={sessionId} />
                    }
                    header={
                        <AgentConfigHeader
                            revisionId={entityId}
                            // `/m` mounts the auto-commit engine, so this header shows Save
                            // rather than Commit. The desktop playground keeps Commit.
                            autoSave
                            // The desktop's collapse: the header owns "«", the top bar owns the
                            // "»" that brings the panel back. Without a way OUT, the restore
                            // control in the bar could never be reached.
                            trailing={
                                <SimpleTooltip title="Hide configuration">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Hide configuration"
                                        onClick={() => setConfigCollapsed(true)}
                                        className="h-7 w-7 shrink-0 p-0"
                                    >
                                        <ChevronsLeft size={14} />
                                    </Button>
                                </SimpleTooltip>
                            }
                        />
                    }
                />
            </DrillInBridgeProvider>
        </div>
    )
}
