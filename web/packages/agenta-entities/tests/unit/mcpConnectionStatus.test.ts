/**
 * What a connection row says about itself.
 *
 * Two of the three statuses can be derived and the third cannot, and the cases here pin which is
 * which. A status that guessed "Unreachable" from the only failure flag on the row would report a
 * revoked grant as a server outage and send the person to the wrong repair.
 */
import {describe, expect, it} from "vitest"

import {
    getMcpConnectionCheckLabel,
    getMcpConnectionStatus,
    getMcpConnectionStatusLabel,
    readMcpConnectionHealth,
    readMcpToolCount,
} from "../../src/mcpEndpoint/core/connectionStatus"
import type {MCPEndpoint} from "../../src/mcpEndpoint/core/types"

const endpoint = (overrides: Partial<MCPEndpoint>): MCPEndpoint => ({
    id: "mcp-1",
    auth_mode: "oauth",
    data: {route: {base_url: "https://mcp.example.test"}},
    ...overrides,
})

describe("getMcpConnectionStatus", () => {
    it("calls a working connection connected", () => {
        expect(getMcpConnectionStatus(endpoint({secret_id: "grant-1"}))).toBe("connected")
        expect(getMcpConnectionStatus(endpoint({auth_mode: "none"}))).toBe("connected")
    })

    it("calls a revoked grant an expired login", () => {
        expect(
            getMcpConnectionStatus(endpoint({secret_id: "grant-1", flags: {is_valid: false}})),
        ).toBe("login_expired")
        // Disconnected: the grant went, and the check from its sign-in stayed.
        expect(
            getMcpConnectionStatus(
                endpoint({
                    secret_id: null,
                    data: {
                        route: {base_url: "https://mcp.example.test"},
                        check: {ok: true, checked_at: "2026-10-14T12:00:00Z"},
                    },
                }),
            ),
        ).toBe("login_expired")
    })

    it("calls an OAuth connection never signed in waiting, not expired", () => {
        // A first sign-in still under way has no login to expire.
        const status = getMcpConnectionStatus(endpoint({secret_id: null}))

        expect(status).toBe("waiting_for_sign_in")
        expect(getMcpConnectionStatusLabel(status)).toBe("Waiting for sign-in")
    })

    it("calls a key the server stopped accepting an expired login too", () => {
        // One sentence for both kinds of credential. Which reconnect path the row offers comes
        // from `auth_mode`, not from the status.
        expect(getMcpConnectionStatus(endpoint({auth_mode: "api_key"}))).toBe("login_expired")
        expect(
            getMcpConnectionStatus(
                endpoint({auth_mode: "api_key", secret_id: "key-1", flags: {is_valid: false}}),
            ),
        ).toBe("login_expired")
    })

    it("never reports unreachable, because nothing on the row carries a health check", () => {
        // `flags.is_valid` is written when a call was REFUSED with the handle the row holds. A
        // server that never answered leaves it alone, so reading it as a health check would label
        // every expired login an unreachable host.
        for (const row of [
            endpoint({secret_id: "grant-1"}),
            endpoint({secret_id: "grant-1", flags: {is_valid: false}}),
            endpoint({auth_mode: "none", flags: {is_active: false}}),
        ]) {
            expect(getMcpConnectionStatus(row)).not.toBe("unreachable")
        }
    })
})

describe("readMcpConnectionHealth", () => {
    it("has nothing to report for a connection nobody has checked", () => {
        expect(readMcpConnectionHealth(endpoint({secret_id: "grant-1"}))).toBeNull()
        expect(readMcpConnectionHealth(endpoint({flags: {is_valid: false}}))).toBeNull()
    })

    it("reads the last explicit check off the connection", () => {
        const checked = endpoint({
            data: {
                route: {base_url: "https://mcp.example.test"},
                check: {
                    ok: false,
                    reason: "The server did not answer.",
                    checked_at: "2026-10-14T10:00:00Z",
                },
            },
        })
        expect(readMcpConnectionHealth(checked)).toEqual({
            ok: false,
            reason: "The server did not answer.",
            checkedAt: "2026-10-14T10:00:00Z",
        })
    })

    it("does not let a failed check relabel the row", () => {
        const checked = endpoint({
            secret_id: "grant-1",
            data: {
                route: {base_url: "https://mcp.example.test"},
                check: {
                    ok: false,
                    reason: "The server did not answer.",
                    checked_at: "2026-10-14T10:00:00Z",
                },
            },
        })
        expect(getMcpConnectionStatus(checked)).toBe("connected")
    })
})

describe("getMcpConnectionCheckLabel", () => {
    const fiveMinutesAgo = () => new Date(Date.now() - 5 * 60 * 1000).toISOString()

    it("says when a passed check ran", () => {
        expect(
            getMcpConnectionCheckLabel({ok: true, reason: null, checkedAt: fiveMinutesAgo()}),
        ).toBe("Checked 5m ago")
    })

    it("says when a failed check ran and why it failed", () => {
        expect(
            getMcpConnectionCheckLabel({
                ok: false,
                reason: "The server did not accept that credential.",
                checkedAt: fiveMinutesAgo(),
            }),
        ).toBe("Check failed 5m ago: The server did not accept that credential.")
        expect(
            getMcpConnectionCheckLabel({ok: false, reason: null, checkedAt: fiveMinutesAgo()}),
        ).toBe("Check failed 5m ago")
    })
})

describe("getMcpConnectionStatusLabel", () => {
    it("uses the words the list surfaces show", () => {
        expect(getMcpConnectionStatusLabel("connected")).toBe("Connected")
        expect(getMcpConnectionStatusLabel("login_expired")).toBe("Login expired")
        expect(getMcpConnectionStatusLabel("unreachable")).toBe("Unreachable")
    })
})

describe("readMcpToolCount", () => {
    it("has no count to show, because no row carries one", () => {
        expect(readMcpToolCount(endpoint({}))).toBeNull()
    })

    it("shows a cached count the day a row carries one", () => {
        expect(readMcpToolCount({...endpoint({}), tool_count: 47} as MCPEndpoint)).toBe(47)
        expect(readMcpToolCount({...endpoint({}), tool_count: 0} as MCPEndpoint)).toBe(0)
    })

    it("refuses anything that is not a count", () => {
        for (const value of ["47", -1, 1.5, null, Number.NaN]) {
            expect(readMcpToolCount({...endpoint({}), tool_count: value} as MCPEndpoint)).toBeNull()
        }
    })
})
