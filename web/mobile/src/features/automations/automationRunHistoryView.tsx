import type {AutomationKind} from "@agenta/automation-ui"
import {defineView} from "@agenta/ui/view-stack"
import dynamic from "next/dynamic"

export interface AutomationRunHistoryViewParams {
    automationId: string
    kind: AutomationKind
    workspaceId: string
    projectId: string
    /** Open this run first (the automation view's "Last run"). */
    runId?: string
}

/**
 * One automation's run history as a view (F05 f6 to f9): the list, a run open, and the list and
 * the run side by side once the view is 700px wide. It writes nothing; Done goes back.
 */
export const automationRunHistoryView = defineView<AutomationRunHistoryViewParams>({
    id: "automations.runHistory",
    apply: "immediate",
    // "Widen the panel" gives 760px, which shows the list beside the newest run.
    wide: true,
    Component: dynamic(() => import("./AutomationRunHistoryViewBody"), {ssr: false}),
})
