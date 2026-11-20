import {defineView} from "@agenta/ui/view-stack"

import {lazyView} from "./lazyView"

export type AdvancedViewParams = Record<string, never>

// Every Advanced part is read only on a phone (phone-layout "Read-only views on a phone").

/** "Advanced" (F04 f9): one row per part that applies to the agent; a row opens the part. */
export const advancedView = defineView<AdvancedViewParams>({
    id: "agent.advanced",
    apply: "immediate",
    readOnlyOnPhone: true,
    Component: lazyView(() => import("./AdvancedViewBody")),
})

/** "Execution": the Sandbox select and Revert. A pick changes the configuration at once. */
export const executionView = defineView<AdvancedViewParams>({
    id: "agent.advanced.execution",
    apply: "immediate",
    readOnlyOnPhone: true,
    Component: lazyView(() => import("./ExecutionViewBody")),
})

/** "Agenta tools" (F04 f10): today's body, with Cancel and Save. */
export const agentaToolsView = defineView<AdvancedViewParams>({
    id: "agent.advanced.agentaTools",
    apply: "on_save",
    readOnlyOnPhone: true,
    Component: lazyView(() => import("./AgentaToolsViewBody")),
})

/** "Build kit": today's body (playground only). It changes the playground state at once. */
export const buildKitView = defineView<AdvancedViewParams>({
    id: "agent.advanced.buildKit",
    apply: "immediate",
    readOnlyOnPhone: true,
    Component: lazyView(() => import("./BuildKitViewBody")),
})
