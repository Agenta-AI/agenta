import {defineView} from "@agenta/ui/view-stack"

import {CatalogListSkeleton} from "../CatalogRowSkeleton"

import {lazyView} from "./lazyView"

export type SubagentAddViewParams = Record<string, never>

/** "Add subagents": "+" adds an agent at once; an added row's menu removes it. */
export const subagentAddView = defineView<SubagentAddViewParams>({
    id: "agent.subagent.add",
    apply: "immediate",
    readOnlyOnPhone: true,
    Component: lazyView(
        () => import("./SubagentAddViewBody"),
        // The search row, then Added and All agents.
        <CatalogListSkeleton groups={[3, 3]} />,
    ),
})
