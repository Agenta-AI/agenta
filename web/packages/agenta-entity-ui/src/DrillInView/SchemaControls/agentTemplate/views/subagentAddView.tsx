import {SkeletonBlock} from "@agenta/ui/ui"
import {defineView} from "@agenta/ui/view-stack"

import {CatalogRowSkeleton} from "../CatalogRowSkeleton"

import {lazyView} from "./lazyView"

export type SubagentAddViewParams = Record<string, never>

/** The loaded list's shape: the search row, a group heading, then catalog rows (STATE-02). */
const AddSubagentsSkeleton = () => (
    <div aria-hidden className="flex min-h-0 flex-1 flex-col pt-3">
        <div className="flex shrink-0 items-center px-4 pb-2 pt-1">
            <SkeletonBlock active className="h-control flex-1 rounded-control" />
        </div>
        <div className="flex flex-col px-4">
            <div className="mt-3 flex h-4.5 items-center">
                <SkeletonBlock active className="h-3.5 w-24" />
            </div>
            <div className="pt-2">
                <CatalogRowSkeleton count={4} />
            </div>
        </div>
    </div>
)

/** "Add subagents": "+" adds an agent at once; an added row's menu removes it. */
export const subagentAddView = defineView<SubagentAddViewParams>({
    id: "agent.subagent.add",
    apply: "immediate",
    readOnlyOnPhone: true,
    Component: lazyView(() => import("./SubagentAddViewBody"), <AddSubagentsSkeleton />),
})
