import {useCallback} from "react"

import {automationRunHistoryDrawerAtom} from "@agenta/automation-ui/run-history-drawer-atom"
import {AgentOperationsSections, type TriggerOwnerRef} from "@agenta/entity-ui/drill-in"
import {useSetAtom} from "jotai"

/**
 * The Automations tab of the Configuration page: the same automation list as the right panel's
 * Automations tab. Changes apply at once; no version is made. The page mounts the drawers.
 */
export const ConfigurationAutomationsTab = ({
    revisionId,
    readOnly,
}: {
    revisionId: string
    readOnly: boolean
}) => {
    const openDrawer = useSetAtom(automationRunHistoryDrawerAtom)
    const openRunHistory = useCallback(
        ({id, kind}: TriggerOwnerRef) =>
            openDrawer({automationId: id, kind: kind === "schedule" ? "schedule" : "event"}),
        [openDrawer],
    )
    return (
        <div className="ag-scroll-no-bar min-h-0 flex-1 overflow-y-auto rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer">
            <AgentOperationsSections
                revisionId={revisionId}
                disabled={readOnly}
                sticky={false}
                automationDrawer={null}
                onOpenRunHistory={openRunHistory}
            />
        </div>
    )
}
