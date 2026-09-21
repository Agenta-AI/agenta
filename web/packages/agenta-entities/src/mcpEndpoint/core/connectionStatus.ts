/**
 * What a connection row says about itself, in the words the list surfaces use.
 *
 * `McpConnectionState` answers "what does this connection need from the person": a grant, a key,
 * or nothing. That is the right question inside the connect journey and the wrong one in a list,
 * where a row says whether the connection works. The two vocabularies are kept apart rather than
 * one renamed into the other, because `needs_input` and `needs_auth` take different repair paths
 * and both read as the same thing to someone scanning a table.
 *
 * Three values, and only two of them can be derived today. See `readMcpConnectionHealth`.
 */
import {getMcpConnectionState} from "./connectionState"
import type {MCPEndpoint} from "./types"

export type McpConnectionStatus = "connected" | "login_expired" | "unreachable"

/**
 * The last health check on a connection, as the row would report it.
 *
 * Always null. Nothing on the connection row carries it: the query response has no health field,
 * and `flags.is_valid` is not one. The backend writes `is_valid: false` only when a data-plane call
 * failed with the same secret handle the row still holds, so it reports a credential the server
 * rejected and says nothing at all about a server that is simply down. Deriving "Unreachable" from
 * it would label an expired login as an unreachable host.
 *
 * This is the seam rather than the fix. The status derivation below reads it, so the day the query
 * response carries a health field this function is the only thing that changes. Until then every
 * row reports Connected or Login expired, and Unreachable is never rendered.
 *
 * Tracked as the API gap filed for decision 30.
 */
export function readMcpConnectionHealth(_endpoint: MCPEndpoint): McpConnectionHealth | null {
    return null
}

export interface McpConnectionHealth {
    /** Whether the last check reached the server at all. */
    reachable: boolean
    /** When it ran, for the row's secondary line. */
    checkedAt?: string | null
}

/**
 * The status one row shows.
 *
 * Every state that is not ready reads as an expired login, whatever kind of credential it is: an
 * OAuth grant that was revoked and an API key the server started refusing are the same sentence to
 * the person and differ only in which reconnect path the row offers, which the caller takes from
 * `auth_mode` rather than from here.
 */
export function getMcpConnectionStatus(endpoint: MCPEndpoint): McpConnectionStatus {
    const health = readMcpConnectionHealth(endpoint)
    if (health && !health.reachable) return "unreachable"
    return getMcpConnectionState(endpoint) === "ready" ? "connected" : "login_expired"
}

/** One word per status, on every surface, as `getMcpConnectionStateLabel` does for the other set. */
export function getMcpConnectionStatusLabel(status: McpConnectionStatus): string {
    switch (status) {
        case "connected":
            return "Connected"
        case "login_expired":
            return "Login expired"
        case "unreachable":
            return "Unreachable"
    }
}

/**
 * The tool count a row may show beside its host, or null when there is none to show.
 *
 * Null today for every row. There is no control-plane route that counts a server's tools: the only
 * way to learn the number is `listMcpTools`, which mints a credential and performs a three-call
 * handshake against the server itself, so a ten-row registry would cost ten handshakes on page load
 * and a row whose login has expired would answer with a refusal rather than a number. A list does
 * not get to do that, so a row shows the count only when the connection record carries a cached one
 * and shows the host alone otherwise (decision 32).
 *
 * Read off the record rather than declared on `MCPEndpoint`, because the type mirrors the backend
 * DTO and must not grow a field the backend does not send. A cached count added to the query
 * response starts working here with no other change.
 */
export function readMcpToolCount(endpoint: MCPEndpoint): number | null {
    const cached = (endpoint as {tool_count?: unknown}).tool_count
    if (typeof cached !== "number" || !Number.isInteger(cached) || cached < 0) return null
    return cached
}
