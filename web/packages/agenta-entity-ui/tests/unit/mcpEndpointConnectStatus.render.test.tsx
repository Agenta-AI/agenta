/**
 * The agent config row has to say when a registered OAuth server still needs someone to
 * authorize it, and offer the flow right there — sending the author to Settings mid-configuration
 * is the whole reason this exists.
 */
import type {MCPEndpoint} from "@agenta/entities/mcpEndpoint"
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import {McpEndpointConnectStatus} from "../../src/mcpEndpoint/McpServerConnectAction"

const endpoint = (overrides: Partial<MCPEndpoint>): MCPEndpoint => ({
    id: "mcp-1",
    slug: "exa",
    name: "exa",
    auth_mode: "oauth",
    namespace: "custom",
    data: {route: {base_url: "https://mcp.example.com"}},
    ...overrides,
})

const markup = (row: MCPEndpoint | undefined, disabled?: boolean) =>
    renderToStaticMarkup(
        <McpEndpointConnectStatus endpoint={row} disabled={disabled} onConnect={() => undefined} />,
    )

describe("McpEndpointConnectStatus", () => {
    it("offers Connect for an OAuth server with no grant yet", () => {
        const html = markup(endpoint({}))
        expect(html).toContain("Needs authorization")
        expect(html).toContain("Connect")
    })

    it("reports a connected server instead of asking again", () => {
        const html = markup(endpoint({secret_id: "grant-1"}))
        // The same word the settings list uses for the same state: this surface said
        // Authorized while that one said Ready, which reads as two states.
        expect(html).toContain("Connected")
        expect(html).not.toContain("Needs authorization")
    })

    it("asks again once the gateway marks the grant invalid", () => {
        expect(markup(endpoint({secret_id: "grant-1", flags: {is_valid: false}}))).toContain(
            "Needs authorization",
        )
    })

    it("renders nothing for a server that authorizes some other way", () => {
        expect(markup(endpoint({auth_mode: "api_key"}))).toBe("")
        expect(markup(endpoint({auth_mode: "none"}))).toBe("")
        expect(markup(undefined)).toBe("")
    })

    it("does not offer the flow on a read-only config", () => {
        // The rendered attribute, not the word. The button's own class list carries
        // `disabled:opacity-50`, so a substring match is satisfied whenever it renders at all
        // and passes with the prop dropped entirely (D39).
        expect(markup(endpoint({}), true)).toContain('disabled=""')
    })

    it("offers it on a config that can be edited", () => {
        // The other half: without this, the case above is also satisfied by a button that is
        // always disabled.
        expect(markup(endpoint({}))).not.toContain('disabled=""')
    })
})
