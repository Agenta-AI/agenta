import type {AutomationKind} from "@agenta/automation-ui"
import {defineView} from "@agenta/ui/view-stack"
import dynamic from "next/dynamic"

export interface AutomationViewParams {
    automationId: string
    kind: AutomationKind
    workspaceId: string
    projectId: string
}

/**
 * One automation as a view (F05 f5): the name with its switch, "Runs" and "Settings". The switch
 * and "Save" in "Settings" write the automation at once (target "project"); no agent version is
 * saved. Leaving with unsaved settings asks first: the view registers its form with the stack.
 */
export const automationView = defineView<AutomationViewParams>({
    id: "automations.automation",
    apply: "immediate",
    Component: dynamic(() => import("./AutomationViewBody"), {ssr: false}),
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
