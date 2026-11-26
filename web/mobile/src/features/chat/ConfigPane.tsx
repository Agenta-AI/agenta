import {useContext} from "react"

import {AgentEditorContext, SectionListLayoutContext} from "@agenta/entity-ui/drill-in"
import {AgentBuildPanel} from "@agenta/playground-ui/agent-build"
import {cn} from "@agenta/ui/styles"


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
    inset = false,
}: {
    entityId: string
    /**
     * The side pane on a wide window: the sections sit on the pane's own 24 px line
     * (`panel-side`, LAYOUT-04, ALIGN-01).
     */
    inset?: boolean
    /**
     * A wide host (the builder page pane, B03): the sections are full-width 45 px rows in a
     * centered 760 px column.
     */
    column?: boolean
}) => {
    // The edit right comes from the container (ConfigurationContent), which its open views share.
    const readOnly = useContext(AgentEditorContext)?.readOnly ?? false

    const panel = (
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
    )

    return (
        // On a phone the size container lets a section screen fill the pane (its primary action at
        // the bottom).
        // With `inset`, `px-1` puts the sections' 20 px inset on the pane's 24 px line (the
        // section icons and the row Marks).
        <div
            className={cn(
                "ag-panel-raised ag-scroll-no-bar flex h-full min-h-0 w-full flex-col overflow-y-auto max-md:[container-type:size]",
                inset && "px-1",
            )}
        >
            {/* Only the wide host sets a layout: the Configuration page sets "page" above this. */}
            {column ? (
                <SectionListLayoutContext.Provider value="pane">
                    {panel}
                </SectionListLayoutContext.Provider>
            ) : (
                panel
            )}
        </div>
    )
}
