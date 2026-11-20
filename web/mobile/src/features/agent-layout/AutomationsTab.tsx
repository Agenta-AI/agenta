import {useCallback} from "react"

import {AutomationTriggerDrawers} from "@agenta/automation-ui"
import {
    triggerScheduleDrawerAtom,
    triggerSubscriptionDrawerAtom,
} from "@agenta/entities/gatewayTrigger"
import {AgentOperationsSections, type TriggerOwnerRef} from "@agenta/entity-ui/drill-in"
import {StorageFilesHeader, StorageSection} from "@agenta/entity-ui/drive"
import {useViewStack} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {automationRunHistoryView} from "../automations/automationRunHistoryView"
import {automationNewView, automationView} from "../automations/automationView"
import {DrillInBridgeProvider} from "../chat/DrillInBridgeProvider"
import {useProjectPermissionState} from "../context/useProjectPermission"

/** The list names an event automation by its subscription; the views by the kind "event". */
const kindOf = (kind: TriggerOwnerRef["kind"]) =>
    kind === "schedule" ? ("schedule" as const) : ("event" as const)

/** The Automations tab: the agent's automations and its recent files, as production shows them. */
export const AutomationsTab = ({
    revisionId,
    workspaceId,
    sessionId,
    filesScope,
    projectId,
}: {
    revisionId: string
    workspaceId: string
    /** The session whose recent files show under the automations; absent, no files part. */
    sessionId?: string
    filesScope?: string
    projectId: string
}) => {
    const editAccess = useProjectPermissionState(projectId, "edit_workflows")
    const stack = useViewStack()
    // The automation drawer hosts its own catalog; while it is open, the tab's copy stays out so
    // one catalog answers "Connect another app".
    const scheduleDrawer = useAtomValue(triggerScheduleDrawerAtom)
    const subscriptionDrawer = useAtomValue(triggerSubscriptionDrawerAtom)
    const drawerOpen = Boolean(scheduleDrawer ?? subscriptionDrawer)
    // The run history, the automation and the new forms open in the panel as views.
    const openRunHistory = useCallback(
        ({id, kind}: TriggerOwnerRef) =>
            void stack.open(
                automationRunHistoryView,
                {automationId: id, kind: kindOf(kind), workspaceId, projectId},
                {kind: "project"},
            ),
        [projectId, stack, workspaceId],
    )
    const openAutomation = useCallback(
        ({id, kind}: TriggerOwnerRef) =>
            void stack.open(
                automationView,
                {automationId: id, kind: kindOf(kind), workspaceId, projectId},
                {kind: "project"},
            ),
        [projectId, stack, workspaceId],
    )
    const addAutomation = useCallback(
        (kind: TriggerOwnerRef["kind"], references: Record<string, {id?: string; slug?: string}>) =>
            void stack.open(
                automationNewView,
                {kind: kindOf(kind), revisionId, references},
                {kind: "project"},
            ),
        [revisionId, stack],
    )
    return (
        <div className="ag-scroll-no-bar h-full min-h-0 overflow-y-auto">
            <DrillInBridgeProvider projectId={projectId}>
                <AgentOperationsSections
                    revisionId={revisionId}
                    disabled={!editAccess.pending && !editAccess.allowed}
                    sticky={false}
                    showFiles={Boolean(sessionId && filesScope)}
                    storage={
                        sessionId && filesScope ? (
                            <StorageSection
                                revisionId={revisionId}
                                sessionId={sessionId}
                                scope={filesScope}
                            />
                        ) : null
                    }
                    storageHeader={
                        sessionId && filesScope ? (
                            <StorageFilesHeader
                                revisionId={revisionId}
                                sessionId={sessionId}
                                scope={filesScope}
                            />
                        ) : null
                    }
                    // The automations open as views; the session workspace still mounts the
                    // automation drawers for its other openers.
                    automationDrawer={null}
                    onOpenRunHistory={openRunHistory}
                    onOpenAutomation={openAutomation}
                    onAddAutomation={addAutomation}
                />
                {/* "Connect another app" in the automation forms opens the integration catalog
                    by atom; the tab root stays mounted under its views, so it hosts it. */}
                {drawerOpen ? null : <AutomationTriggerDrawers />}
            </DrillInBridgeProvider>
        </div>
    )
}
