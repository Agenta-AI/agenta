/**
 * Unit tests for the pure helpers in `useConnectFlow` — the connect-mode resolver (bug: a
 * toolkit with no Composio-managed OAuth, e.g. telegram, was always attempted as "oauth"
 * and 404'd) and the error-message extractor (bug: a create failure settled the parked
 * call silently, with no error surfaced anywhere — see ConnectToolWidget.test / the
 * ConnectToolWidget KNOWN_CONNECT_REASONS branch this message feeds).
 */
import {describe, expect, it} from "vitest"

import {extractConnectErrorMessage, resolveConnectMode} from "./useConnectFlow"

describe("resolveConnectMode", () => {
    it("keeps the hint when the catalog has no auth_schemes yet (loading, or backend reported none)", () => {
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
