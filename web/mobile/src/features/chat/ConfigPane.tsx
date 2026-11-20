import {useContext} from "react"

import {ModelSetupBanner} from "@agenta/chat/components"
import {AgentEditorContext} from "@agenta/entity-ui/drill-in"
import {AgentBuildPanel} from "@agenta/playground-ui/agent-build"
import {AgentConfigHeader} from "@agenta/playground-ui/agent-config-header"

import {useOpenModelSetup} from "./useOpenModelSetup"

/**
 * Build's left pane: the SHARED config panel under the SHARED "Configuration" header, with the
 * SHARED Files region — the same three components the desktop playground renders.
 *
 * The DrillIn bridge sits above it, around the panel's view stack (`ConfigurationContent`).
 *
 * Deploy and the overflow menu are absent, not reproduced: both still read this app's app-layer
 * state on the desktop side, and the header takes them as slots precisely so a surface that
 * cannot offer them simply does not.
 */
export const ConfigPane = ({entityId}: {entityId: string}) => {
    const openModelSetup = useOpenModelSetup()
    // The edit right comes from the container (ConfigurationContent), which its open views share.
    const readOnly = useContext(AgentEditorContext)?.readOnly ?? false

    return (
        <div className="ag-panel-raised ag-scroll-no-bar flex h-full min-h-0 w-full flex-col overflow-y-auto">
            <AgentBuildPanel
                revisionId={entityId}
                disabled={readOnly}
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
        </div>
    )
}
