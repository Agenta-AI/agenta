/**
 * Unit tests for the pure helpers in `useConnectFlow` — the connect-mode resolver (bug: a
 * toolkit with no Composio-managed OAuth, e.g. telegram, was always attempted as "oauth"
 * and 404'd), the mode-resolving guard (CodeRabbit finding on #5909: `resolveConnectMode`'s
 * "keep the hint while loading" fallback is fine for the RENDER, but a click landing in that
 * same window must not be allowed to fire a request with the raw, unverified hint), and the
 * error-message extractor (bug: a create failure settled the parked call silently, with no
 * error surfaced anywhere — see the ConnectToolWidget KNOWN_CONNECT_REASONS branch this
 * message feeds).
 */
import {describe, expect, it} from "vitest"

import {
    extractConnectErrorMessage,
    isConnectModeResolving,
    resolveConnectMode,
} from "./useConnectFlow"

describe("resolveConnectMode", () => {
    it("RENDER fallback: keeps the hint when the catalog has no auth_schemes yet (loading, or backend reported none) — `isConnectModeResolving` below is what stops a click from acting on this before it's verified", () => {
        expect(resolveConnectMode("oauth", undefined)).toBe("oauth")
        expect(resolveConnectMode("oauth", null)).toBe("oauth")
        expect(resolveConnectMode("api_key", [])).toBe("api_key")
    })

    it("keeps the hint when the toolkit actually supports it", () => {
        expect(resolveConnectMode("oauth", ["oauth"])).toBe("oauth")
        expect(resolveConnectMode("api_key", ["api_key"])).toBe("api_key")
        expect(resolveConnectMode("oauth", ["oauth", "api_key"])).toBe("oauth")
    })

    it("telegram case: an 'oauth' hint against a toolkit with only api_key falls back to api_key", () => {
        expect(resolveConnectMode("oauth", ["api_key"])).toBe("api_key")
    })

    it("the reverse: an 'api_key' hint against an oauth-only toolkit falls back to oauth", () => {
        expect(resolveConnectMode("api_key", ["oauth"])).toBe("oauth")
    })
})

describe("isConnectModeResolving", () => {
    it("blocks: a real integration key, the catalog lookup in flight, not timed out — the exact window a click must not act in", () => {
        expect(
            isConnectModeResolving({
                hasIntegrationKey: true,
                queryIsLoading: true,
                timedOut: false,
            }),
        ).toBe(true)
    })

    it("unblocks once the lookup settles (success or error) — queryIsLoading flips false", () => {
        expect(
            isConnectModeResolving({
                hasIntegrationKey: true,
                queryIsLoading: false,
                timedOut: false,
            }),
        ).toBe(false)
    })

    it("unblocks for a malformed call with no integration key, even mid-'loading' — a disabled TanStack Query reports isLoading:true forever, which must not permanently disable Connect", () => {
        expect(
            isConnectModeResolving({
                hasIntegrationKey: false,
                queryIsLoading: true,
                timedOut: false,
            }),
        ).toBe(false)
    })

    it("unblocks once timed out, even if the query is still loading — a stuck lookup (dead network) cannot latch the button disabled forever", () => {
        expect(
            isConnectModeResolving({hasIntegrationKey: true, queryIsLoading: true, timedOut: true}),
        ).toBe(false)
    })
})

describe("extractConnectErrorMessage", () => {
    it("prefers the backend's detail string on a 4xx", () => {
        const err = {
            statusCode: 422,
            body: {detail: "telegram requires custom OAuth credentials in this environment."},
        }
        expect(extractConnectErrorMessage(err)).toBe(
            "telegram requires custom OAuth credentials in this environment.",
        )
    })

    it("falls back to a generic message on a 5xx even with a detail present", () => {
        const err = {statusCode: 502, body: {detail: "upstream exploded"}}
        expect(extractConnectErrorMessage(err)).toBe("Connection failed. Please try again.")
    })

    it("falls back to a generic message when there is no parseable body/detail", () => {
        expect(extractConnectErrorMessage(new Error("network down"))).toBe(
            "Connection failed. Please try again.",
        )
        expect(extractConnectErrorMessage({statusCode: 422, body: {}})).toBe(
            "Connection failed. Please try again.",
        )
        expect(extractConnectErrorMessage(null)).toBe("Connection failed. Please try again.")
    })
})
