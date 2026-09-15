/**
 * The agent config form is where people actually add an MCP server, and until now its
 * Authentication select offered OAuth only as a disabled "Soon" row — so an OAuth server could be
 * registered from Settings and nowhere else. These cases pin the two rules that let the form
 * express OAuth without writing a config the SDK will refuse to parse.
 */
import {describe, expect, it} from "vitest"

import {
    mcpAuthenticationCredentials,
    resolveMcpAuthenticationType,
} from "../../src/DrillInView/SchemaControls/mcpServerAuthentication"

const noSecret = {name: "", slug: ""}

describe("mcpAuthenticationCredentials", () => {
    it("writes the oauth marker registration reads", () => {
        expect(mcpAuthenticationCredentials("oauth", noSecret)).toEqual({type: "oauth"})
    })

    it("writes a bare none when the server needs no credentials", () => {
        expect(mcpAuthenticationCredentials("none", noSecret)).toEqual({type: "none"})
    })

    it("carries a complete secret-header binding through", () => {
        expect(
            mcpAuthenticationCredentials("header_secret_refs", {name: "x-api-key", slug: "exa"}),
        ).toEqual({type: "header_secret_refs", headers: {"x-api-key": "exa"}})
    })

    it("leaves the header map empty until both halves are chosen", () => {
        expect(
            mcpAuthenticationCredentials("header_secret_refs", {name: "x-api-key", slug: ""}),
        ).toEqual({type: "header_secret_refs", headers: {}})
    })
})

describe("resolveMcpAuthenticationType", () => {
    it("reads OAuth back off the endpoint row a saved config cannot express", () => {
        expect(resolveMcpAuthenticationType("none", "oauth")).toBe("oauth")
    })

    it("leaves an unregistered draft showing what it says", () => {
        expect(resolveMcpAuthenticationType("none", undefined)).toBe("none")
        expect(resolveMcpAuthenticationType("oauth", undefined)).toBe("oauth")
    })

    it("does not overrule an author who is binding a secret header", () => {
        expect(resolveMcpAuthenticationType("header_secret_refs", "oauth")).toBe(
            "header_secret_refs",
        )
    })

    it("leaves an api-key row alone", () => {
        expect(resolveMcpAuthenticationType("none", "api_key")).toBe("none")
    })
})
