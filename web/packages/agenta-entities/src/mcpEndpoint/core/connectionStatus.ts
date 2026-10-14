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
import {timeAgo} from "@agenta/shared/utils"

import {getMcpConnectionState} from "./connectionState"
import type {MCPEndpoint} from "./types"

export type McpConnectionStatus = "connected" | "login_expired" | "unreachable"

/**
 * The last explicit check of a connection, or null when nobody has checked it.
 *
 * Written only when the connect sheet or a reconnect verifies the connection, never by an agent
 * call, so it says when someone last looked rather than how the connection is doing now. That is
 * why it does not drive the status: a check that failed last week must not relabel a working row.
 * Telling an unreachable server from an expired login needs a live health signal (issue #6907).
 */
export function readMcpConnectionHealth(endpoint: MCPEndpoint): McpConnectionHealth | null {
    const check = endpoint.data?.check
    if (!check?.checked_at) return null
    return {ok: check.ok, reason: check.reason ?? null, checkedAt: check.checked_at}
}

export interface McpConnectionHealth {
    /** Whether the check passed. */
    ok: boolean
    /** The short reason a failed check gave. */
    reason: string | null
    /** When it ran. */
    checkedAt: string
}

/** The row's line for the last check: "Checked 5m ago", or "Check failed 5m ago: <reason>". */
export function getMcpConnectionCheckLabel(health: McpConnectionHealth): string {
    const when = timeAgo(Date.parse(health.checkedAt))
    if (health.ok) return `Checked ${when}`
    return health.reason ? `Check failed ${when}: ${health.reason}` : `Check failed ${when}`
}

/**
 * The status one row shows.
 *
 * Every state that is not ready reads as an expired login, whatever kind of credential it is: an
 * OAuth grant that was revoked and an API key the server started refusing are the same sentence to
 * the person and differ only in which reconnect path the row offers, which the caller takes from
 * `auth_mode` rather than from here. "Unreachable" is never derived yet; see
 * `readMcpConnectionHealth`.
 */
export function getMcpConnectionStatus(endpoint: MCPEndpoint): McpConnectionStatus {
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
