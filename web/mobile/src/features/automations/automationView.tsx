import {AutomationPaneSkeleton, type AutomationKind} from "@agenta/automation-ui"
import {defineView} from "@agenta/ui/view-stack"
import dynamic from "next/dynamic"

/** The body's own loading shape while its code loads, in the view's place (STATE-02). */
const AutomationViewLoading = () => <AutomationPaneSkeleton />

export interface AutomationViewParams {
    automationId: string
    kind: AutomationKind
    workspaceId: string
    projectId: string
    /**
     * Open the run history over the automation at once (the row menu's "Run history"), so the
     * crumb reads "Automations › <name> › Run history" and Back returns to the automation.
     */
    openRuns?: boolean
}

/**
 * One automation as a view (F05 f5): the name with its switch, "Runs" and "Settings". The switch
 * and "Save" in "Settings" write the automation at once (target "project"); no agent version is
 * saved, and the view stays open after Save. Leaving asks first only when the settings differ from
 * the saved automation. The chrome draws the action row: Delete at its start
 * (`ViewFooterStart`), then Cancel and Save.
 */
export const automationView = defineView<AutomationViewParams>({
    id: "automations.automation",
    apply: "on_save",
    Component: dynamic(() => import("./AutomationViewBody"), {
        ssr: false,
        loading: AutomationViewLoading,
    }),
})

export interface AutomationNewViewParams {
    kind: AutomationKind
    /** The agent's revision on screen; the new automation is bound to its agent. */
    revisionId: string
    /** The agent's references, as `data.references` stores them. */
    references: Record<string, {id?: string; slug?: string}>
}

/** "New automation" (F05 f3, f4): the form of the kind chosen in "Add automation". */
export const automationNewView = defineView<AutomationNewViewParams>({
    id: "automations.new",
    apply: "on_save",
    Component: dynamic(() => import("./AutomationNewViewBody"), {ssr: false}),
})
