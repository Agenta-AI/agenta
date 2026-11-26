import {SkeletonBlock} from "@agenta/ui/ui"
import {defineView} from "@agenta/ui/view-stack"

import {CatalogRowSkeleton} from "../CatalogRowSkeleton"

import {lazyView} from "./lazyView"

export type McpAddViewParams = Record<string, never>

/**
 * "Add MCP server" (F03 f4): a picker over the project's servers. A click adds the server to the
 * agent and opens its server view in place; "Connect server" opens the connect step at depth 2
 * with the target project. A picker has no Done; the back arrow and close leave.
 */
export const mcpAddView = defineView<McpAddViewParams>({
    id: "agent.mcp.add",
    apply: "immediate",
    readOnlyOnPhone: true,
    actionRow: false,
    Component: lazyView(
        () => import("./McpAddViewBody"),
        // The loaded layout: the search row, then the catalog rows (STATE-02).
        <div className="flex flex-col gap-4 px-4 pt-4">
            <SkeletonBlock active className="h-control" />
            <CatalogRowSkeleton count={3} />
        </div>,
    ),
})
