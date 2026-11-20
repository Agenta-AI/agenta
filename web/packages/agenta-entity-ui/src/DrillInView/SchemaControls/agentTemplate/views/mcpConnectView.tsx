import type {McpReconnectTarget} from "@agenta/entities/mcpEndpoint"
import {defineView} from "@agenta/ui/view-stack"

import {lazyView} from "./lazyView"

export interface McpConnectViewParams {
    /** Reconnect a server that exists already, instead of connecting a new one. */
    reconnect?: McpReconnectTarget | null
    /** The connection, once it is made. The view has left by then. */
    onConnected?: (endpoint: {id: string; slug: string; name: string}) => void
}

/**
 * "Connect server" (F03 f5) and the reconnect step. Its target is always the project: it stores
 * the server there. Adding the server to an agent is a separate write by the view that opened it.
 * Each step's action is the view's Save; a step that worked keeps the view open ("stay"), and the
 * view leaves by itself when the connection is made.
 */
export const mcpConnectView = defineView<McpConnectViewParams>({
    id: "mcp.connect",
    apply: "on_save",
    Component: lazyView(() => import("./McpConnectViewBody")),
})
