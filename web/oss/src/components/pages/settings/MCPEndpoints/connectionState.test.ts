import {describe, expect, it} from "vitest"

import {MCPEndpoint} from "@/oss/services/mcpEndpoints/types"

import {getMcpConnectionState, getMcpConnectionStateLabel} from "./connectionState"

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
})

describe("getMcpConnectionStateLabel", () => {
    it("keeps state names product-facing", () => {
        expect(getMcpConnectionStateLabel("needs_auth")).toBe("Needs authorization")
        expect(getMcpConnectionStateLabel("needs_input")).toBe("Needs input")
    })
})
