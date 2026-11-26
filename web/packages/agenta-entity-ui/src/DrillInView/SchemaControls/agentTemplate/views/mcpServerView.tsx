import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import type {ConfigItemRef} from "@agenta/ui/view-stack"
import {defineView} from "@agenta/ui/view-stack"
import {useAtomValue} from "jotai"

import {lazyView} from "./lazyView"
import {ToolPermissionsViewSkeleton} from "./ToolPermissionsViewSkeleton"

/**
 * In an agent: the server by its key in the agent's `mcps`. In Settings (target project): the
 * project's connection by its slug, read-only, because a permission belongs to an agent.
 */
export type McpServerViewParams = {item: ConfigItemRef} | {connectionSlug: string}

/** The account part offers each person's own sign-in only with personal accounts on. */
const McpServerViewSkeleton = () => (
    <ToolPermissionsViewSkeleton
        account={useAtomValue(personalAccountsAccessAtom) === "on" ? "switch" : "line"}
    />
)

/**
 * One MCP server (F03 f6, f7): the title with its state, the account, the default permission and
 * the tools. Every change writes the agent configuration at once; Done goes back.
 */
export const mcpServerView = defineView<McpServerViewParams>({
    id: "mcp.server",
    apply: "immediate",
    Component: lazyView(
        () => import("./McpServerViewBody"),
        <McpServerViewSkeleton />,
    ),
})
