import {defineView} from "@agenta/ui/view-stack"

import {CatalogRowSkeleton} from "../CatalogRowSkeleton"

import {lazyView} from "./lazyView"

export type SubagentAddViewParams = Record<string, never>

/**
 * "Add subagents" (F03 f1): a picker. A click on an agent adds it to the agent at once, a second
 * click removes it. Done goes back.
 */
export const subagentAddView = defineView<SubagentAddViewParams>({
    id: "agent.subagent.add",
    apply: "immediate",
    Component: lazyView(
        () => import("./SubagentAddViewBody"),
        <div className="px-4 py-3">
            <CatalogRowSkeleton />
        </div>,
    ),
})
