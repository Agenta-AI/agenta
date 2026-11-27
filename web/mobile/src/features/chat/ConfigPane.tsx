import {useContext} from "react"

import {AgentEditorContext} from "@agenta/entity-ui/drill-in"
import {AgentBuildPanel} from "@agenta/playground-ui/agent-build"

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
export const ConfigPane = ({
    entityId,
    column = false,
    page = false,
}: {
    entityId: string
    /** A wide host (the builder page pane): the sections sit in a centered 760 px column. */
    column?: boolean
    /** A page body: the page scrolls, so the sections take their own height. */
    page?: boolean
}) => {
    // The edit right comes from the container (ConfigurationContent), which its open views share.
    const readOnly = useContext(AgentEditorContext)?.readOnly ?? false

    return (
        // On a phone the size container lets a section screen fill the pane (its primary action at
        // the bottom). The sections' own 16 px inset is the pane's line (ALIGN-01).
        <div
            className={
                page
                    ? "flex w-full flex-col"
                    : "ag-panel-raised ag-scroll-no-bar flex h-full min-h-0 w-full flex-col overflow-y-auto max-md:[container-type:size]"
            }
        >
            <AgentBuildPanel
                className={column ? "mx-auto w-full max-w-content-md" : undefined}
                revisionId={entityId}
                disabled={readOnly}
                // Automations and files have their own places in the panel.
                operations={false}
                stickyHeaderTop={0}
                // The operational sections (and their drawers) live in the Automations tab.
                automationDrawer={null}
            />
        </div>
    )
}
