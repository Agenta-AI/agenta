import type {ConfigItemRef} from "@agenta/ui/view-stack"
import {defineView} from "@agenta/ui/view-stack"

import {lazyView} from "./lazyView"

export interface SubagentViewParams {
    /** The subagent, by its key in the agent's tools. */
    item: ConfigItemRef
}

/**
 * One subagent of the agent (F03 f2, f3): its description, which Save writes to the agent
 * configuration, over a read-only summary of the agent it calls.
 */
export const subagentView = defineView<SubagentViewParams>({
    id: "agent.subagent",
    apply: "on_save",
    Component: lazyView(() => import("./SubagentViewBody")),
})
