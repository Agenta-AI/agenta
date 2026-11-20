import type {McpConnectedEndpoint, McpReconnectTarget} from "@agenta/entities/mcpEndpoint"
import {defineView} from "@agenta/ui/view-stack"

import type {ConnectionOwner} from "../../../../accounts/ConnectOwnerField"

import {lazyView} from "./lazyView"

export interface McpConnectViewParams {
    /** Reconnect a server that exists already, instead of connecting a new one. */
    reconnect?: McpReconnectTarget | null
    /**
     * Who may own a new server's OAuth sign-in; the first is the default. Two ask "Who can use
     * it". Absent, the sign-in is the project's.
     */
    owners?: ConnectionOwner[]
    /** The connection, once it is made, and whose sign-in it stored. The view has left by then. */
    onConnected?: (endpoint: McpConnectedEndpoint) => void
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
