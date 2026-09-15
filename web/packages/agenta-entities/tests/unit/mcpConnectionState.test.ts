import {describe, expect, it} from "vitest"

import type {MCPEndpoint} from "../../src/mcpEndpoint/core/types"
import {
    findCustomMcpEndpoint,
    getMcpConnectionState,
    getMcpConnectionStateLabel,
} from "../../src/mcpEndpoint/core/connectionState"

const endpoint = (overrides: Partial<MCPEndpoint>): MCPEndpoint => ({
    id: "mcp-1",
    auth_mode: "oauth",
    data: {route: {base_url: "https://mcp.example.test"}},
    ...overrides,
})

describe("getMcpConnectionState", () => {
    it("treats unauthenticated servers as ready", () => {
        expect(getMcpConnectionState(endpoint({auth_mode: "none"}))).toBe("ready")
    })

    it("shows needs authorization when an OAuth server has no usable grant", () => {
        expect(getMcpConnectionState(endpoint({secret_id: null}))).toBe("needs_auth")
        expect(
            getMcpConnectionState(endpoint({secret_id: "grant-1", flags: {is_valid: false}})),
        ).toBe("needs_auth")
    })

    it("shows needs input when an API-key server has no usable secret", () => {
        expect(getMcpConnectionState(endpoint({auth_mode: "api_key"}))).toBe("needs_input")
    })

    it("shows ready only for a valid configured credential", () => {
        expect(getMcpConnectionState(endpoint({secret_id: "grant-1"}))).toBe("ready")
    })

    // The settings table used to answer these two from the presence of a COMPOSIO_API_KEY
    // provider-key secret instead, which reported a dead grant as ready and a working row as
    // needing input. Every row now reports its own state, so the cases belong here.
    it("reads a provider-managed row from its own credential, not from a project key", () => {
        const composio = {namespace: "standard" as const, provider_key: "composio"}

        expect(getMcpConnectionState(endpoint({...composio, secret_id: "grant-1"}))).toBe("ready")
        expect(
            getMcpConnectionState(
                endpoint({...composio, secret_id: "grant-1", flags: {is_valid: false}}),
            ),
        ).toBe("needs_auth")
    })

    it("does not call a provider-managed row ready just because it is provider-managed", () => {
        expect(
            getMcpConnectionState(
                endpoint({
                    namespace: "standard",
                    provider_key: "composio",
                    auth_mode: "api_key",
                }),
            ),
        ).toBe("needs_input")
    })
})

describe("getMcpConnectionStateLabel", () => {
    it("keeps state names product-facing", () => {
        expect(getMcpConnectionStateLabel("needs_auth")).toBe("Needs authorization")
        expect(getMcpConnectionStateLabel("needs_input")).toBe("Needs input")
    })
})

describe("findCustomMcpEndpoint", () => {
    const row = (overrides: Partial<MCPEndpoint>): MCPEndpoint => ({
        slug: "exa",
        auth_mode: "oauth",
        data: {route: {base_url: "https://mcp.example.com"}},
        ...overrides,
    })

    it("matches the custom row a config item's slug names", () => {
        const rows = [row({slug: "other"}), row({slug: "exa"})]
        expect(findCustomMcpEndpoint(rows, "exa")?.slug).toBe("exa")
    })

    it("treats a row with no namespace as custom, which is what registration writes", () => {
        expect(findCustomMcpEndpoint([row({namespace: undefined})], "exa")).toBeDefined()
    })

    it("ignores a provider-managed row of the same name", () => {
        expect(findCustomMcpEndpoint([row({namespace: "standard"})], "exa")).toBeUndefined()
    })

    it("returns nothing without a slug or a loaded list", () => {
        expect(findCustomMcpEndpoint([row({})], undefined)).toBeUndefined()
        expect(findCustomMcpEndpoint(undefined, "exa")).toBeUndefined()
    })
})
