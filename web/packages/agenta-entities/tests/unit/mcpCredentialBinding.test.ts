/**
 * Where an API key goes, as the key screen shows it and as the relay sends it.
 *
 * The preview line has to equal what the relay sends with the value masked
 * (`api/oss/src/core/gateways/mcps/providers/http/adapter.py::injected_credentials`), so the
 * rule is pinned here on both kinds and with and without a prefix.
 */
import {describe, expect, it} from "vitest"

import {
    basicCredentialValue,
    credentialBindingPreview,
    mcpDefaultCredentialBinding,
    normalizeCredentialBinding,
    withoutCredentialParameter,
} from "../../src/mcpEndpoint/core/credentialBinding"
import type {MCPServerProbe} from "../../src/mcpEndpoint/core/types"

const probe = (challenge_schemes: string[]): MCPServerProbe => ({
    reachable: true,
    auth: {mode: "unknown", challenge_schemes, challenge_status: 401},
})

describe("credentialBindingPreview", () => {
    it("puts the prefix and a space in front of the masked value", () => {
        expect(
            credentialBindingPreview({kind: "header", name: "Authorization", prefix: "Basic"}),
        ).toBe("Authorization: Basic ••••")
    })

    it("sends the bare value when there is no prefix", () => {
        expect(credentialBindingPreview({kind: "header", name: "CONTEXT7_API_KEY"})).toBe(
            "CONTEXT7_API_KEY: ••••",
        )
        // Custom chosen with nothing typed is no prefix, as the API stores it.
        expect(credentialBindingPreview({kind: "header", name: "x-api-key", prefix: " "})).toBe(
            "x-api-key: ••••",
        )
    })

    it("shows a query binding as the parameter it adds", () => {
        expect(credentialBindingPreview({kind: "query", name: "exaApiKey"})).toBe(
            "?exaApiKey=••••",
        )
    })

    it("shows nothing while there is no name, because nothing is sent", () => {
        expect(credentialBindingPreview({kind: "header", name: "  ", prefix: "Bearer"})).toBeNull()
    })
})

describe("normalizeCredentialBinding", () => {
    it("trims the name and turns a blank prefix into none", () => {
        expect(normalizeCredentialBinding({kind: "header", name: " x-api-key ", prefix: ""})).toEqual(
            {kind: "header", name: "x-api-key", prefix: null},
        )
        expect(
            normalizeCredentialBinding({kind: "header", name: "Authorization", prefix: " Token "}),
        ).toEqual({kind: "header", name: "Authorization", prefix: "Token"})
    })
})

describe("normalizeCredentialBinding on a query binding", () => {
    it("drops a prefix, which a query value does not take", () => {
        expect(normalizeCredentialBinding({kind: "query", name: "token", prefix: "Bearer"})).toEqual(
            {kind: "query", name: "token", prefix: null},
        )
        expect(credentialBindingPreview({kind: "query", name: "token", prefix: "Bearer"})).toBe(
            "?token=••••",
        )
    })
})

describe("withoutCredentialParameter", () => {
    const binding = {kind: "query" as const, name: "exaApiKey"}

    it("drops the parameter the binding fills, and keeps the rest", () => {
        expect(
            withoutCredentialParameter("https://mcp.exa.test/mcp?exaApiKey=test-key-one&debug=on", binding),
        ).toBe("https://mcp.exa.test/mcp?debug=on")
        expect(withoutCredentialParameter("https://mcp.exa.test/mcp?exaApiKey=test-key-one", binding)).toBe(
            "https://mcp.exa.test/mcp",
        )
    })

    it("leaves the URL as typed when there is nothing to drop", () => {
        expect(withoutCredentialParameter("https://mcp.exa.test/mcp?debug=on", binding)).toBe(
            "https://mcp.exa.test/mcp?debug=on",
        )
        // A header binding sends nothing in the URL.
        expect(
            withoutCredentialParameter("https://mcp.exa.test/mcp?exaApiKey=x", {
                kind: "header",
                name: "exaApiKey",
            }),
        ).toBe("https://mcp.exa.test/mcp?exaApiKey=x")
        expect(withoutCredentialParameter("not a url", binding)).toBe("not a url")
    })
})

describe("mcpDefaultCredentialBinding", () => {
    it("starts a scheme server at Authorization with Bearer", () => {
        expect(mcpDefaultCredentialBinding(probe(["Bearer"]))).toEqual({
            kind: "header",
            name: "Authorization",
            prefix: "Bearer",
        })
        // What a connection with no binding sends, so a reconnect that probes nothing agrees.
        expect(mcpDefaultCredentialBinding(null)).toEqual({
            kind: "header",
            name: "Authorization",
            prefix: "Bearer",
        })
    })

    it("starts any other server at a bare x-api-key", () => {
        expect(mcpDefaultCredentialBinding(probe([]))).toEqual({
            kind: "header",
            name: "x-api-key",
            prefix: null,
        })
    })
})

describe("basicCredentialValue", () => {
    it("encodes username:password in base64 once", () => {
        expect(basicCredentialValue("user", "pass")).toBe("dXNlcjpwYXNz")
        expect(atob(basicCredentialValue("login@example.com", "a:b"))).toBe(
            "login@example.com:a:b",
        )
    })

    it("encodes UTF-8 first, so a character outside Latin-1 does not throw", () => {
        expect(basicCredentialValue("jürgen", "пароль")).toBe(
            Buffer.from("jürgen:пароль", "utf8").toString("base64"),
        )
    })
})
