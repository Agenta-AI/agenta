import {describe, expect, it} from "vitest"

import {buildTrustedOrigins, isTrustedOauthConnectedMessage} from "./connectMessage"

describe("buildTrustedOrigins", () => {
    it("collects the origin of every valid URL", () => {
        const origins = buildTrustedOrigins([
            "https://app.example.test/settings",
            "https://api.example.test/gateways",
        ])

        expect(origins).toEqual(new Set(["https://app.example.test", "https://api.example.test"]))
    })

    it("ignores undefined and invalid URLs", () => {
        const origins = buildTrustedOrigins([undefined, "not a url", "https://app.example.test"])

        expect(origins).toEqual(new Set(["https://app.example.test"]))
    })
})

describe("isTrustedOauthConnectedMessage", () => {
    const trusted = buildTrustedOrigins(["https://app.example.test"])

    it("accepts the connected message from a trusted origin", () => {
        expect(
            isTrustedOauthConnectedMessage(
                {type: "mcp:oauth:connected"},
                "https://app.example.test",
                trusted,
            ),
        ).toBe(true)
    })

    it("rejects a message from an untrusted origin", () => {
        expect(
            isTrustedOauthConnectedMessage(
                {type: "mcp:oauth:connected"},
                "https://evil.test",
                trusted,
            ),
        ).toBe(false)
    })

    it("rejects a differently-typed message from a trusted origin", () => {
        expect(
            isTrustedOauthConnectedMessage(
                {type: "tools:oauth:complete"},
                "https://app.example.test",
                trusted,
            ),
        ).toBe(false)
    })

    it("rejects a non-object payload", () => {
        expect(isTrustedOauthConnectedMessage("hello", "https://app.example.test", trusted)).toBe(
            false,
        )
    })
})
