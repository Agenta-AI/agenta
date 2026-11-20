import {useContext} from "react"

import {ModelSetupBanner} from "@agenta/chat/components"
import {AgentEditorContext} from "@agenta/entity-ui/drill-in"
import {AgentBuildPanel} from "@agenta/playground-ui/agent-build"

import {useOpenModelSetup} from "./useOpenModelSetup"

/**
 * The Agent tab of the panel: the SHARED config panel, the same sections the desktop playground
 * renders.
 *
 * No "Configuration" header bar: the tab already names the content, and the save status and
 * version show in the session header, as production (auto-save, no Save button). Auto-save does
 * not depend on this pane: `agentAutoCommit.ts` registers on the draft write when it loads.
 *
 * The DrillIn bridge sits above it, around the panel's view stack (`ConfigurationContent`).
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
                stickyHeaderTop={0}
                banner={
                    // The alert keeps a gap under the tabs; it collapses with the banner.
                    <div className="px-4 [&_[data-slot=alert]]:mt-3">
                        <ModelSetupBanner
                            revisionId={entityId}
                            layout="alert"
                            onSetUp={openModelSetup}
                        />
                    </div>
                }
                // The operational sections (and their drawers) live in the Automations tab.
                automationDrawer={null}
            />
        </div>
    )
}
