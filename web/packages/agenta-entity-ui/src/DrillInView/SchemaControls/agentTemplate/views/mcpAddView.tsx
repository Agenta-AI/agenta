import {SkeletonRows} from "@agenta/ui/ui"
import {defineView} from "@agenta/ui/view-stack"

import {lazyView} from "./lazyView"

export type McpAddViewParams = Record<string, never>

/**
 * "Add MCP server" (F03 f4): a picker over the project's servers. A click adds the server to the
 * agent and opens its server view in place; "Connect server" opens the connect step at depth 2
 * with the target project. Done goes back.
 */
export const mcpAddView = defineView<McpAddViewParams>({
    id: "agent.mcp.add",
    apply: "immediate",
    // Read only on a phone (phone-layout "Read-only views on a phone").
    readOnlyOnPhone: true,
    Component: lazyView(
        () => import("./McpAddViewBody"),
        <div className="px-4 py-3">
            <SkeletonRows rowClassName="h-[58px]" />
        </div>,
    ),
})
