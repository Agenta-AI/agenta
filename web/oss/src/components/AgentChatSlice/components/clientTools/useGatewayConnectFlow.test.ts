/**
 * Unit tests for the pure helpers in `useGatewayConnectFlow` (WP26): parsing a call's `target`
 * out of `meta.input`, and the settle-output builders for each terminal state. No React render,
 * no real drawer, no real backend — mirrors `useConnectFlow.test.ts`'s style of testing the
 * extracted pure logic directly.
 */
import {describe, expect, it} from "vitest"

import type {MCPEndpoint} from "@/oss/services/mcpEndpoints/types"

import {
    gatewayCancelledOutput,
    gatewayConnectedOutput,
    gatewayDeclinedOutput,
    gatewayTargetLabel,
    parseGatewayTarget,
    resolveCustomMcpEndpoint,
} from "./useGatewayConnectFlow"

describe("parseGatewayTarget", () => {
    it("parses a valid llm-plane target", () => {
        expect(parseGatewayTarget({target: {plane: "llm", name: "openai"}})).toEqual({
            plane: "llm",
            name: "openai",
        })
    })

    it("parses a valid mcp-plane target", () => {
        expect(parseGatewayTarget({target: {plane: "mcp", name: "acme-notion"}})).toEqual({
            plane: "mcp",
            name: "acme-notion",
        })
    })

    it("is null for the existing integration-only call — the two paths never overlap", () => {
        expect(parseGatewayTarget({integration: "slack"})).toBeNull()
    })

    it("is null when target is absent entirely", () => {
        expect(parseGatewayTarget({})).toBeNull()
        expect(parseGatewayTarget(null)).toBeNull()
        expect(parseGatewayTarget(undefined)).toBeNull()
    })

    it("is null for an unknown plane — a model hallucinating a third plane must not silently pass through", () => {
        expect(parseGatewayTarget({target: {plane: "sbx", name: "x"}})).toBeNull()
    })

    it("is null when name is missing or not a string", () => {
        expect(parseGatewayTarget({target: {plane: "llm"}})).toBeNull()
        expect(parseGatewayTarget({target: {plane: "llm", name: ""}})).toBeNull()
        expect(parseGatewayTarget({target: {plane: "llm", name: 42}})).toBeNull()
    })

    it("is null when target is not an object", () => {
        expect(parseGatewayTarget({target: "openai"})).toBeNull()
    })
})

describe("gatewayTargetLabel", () => {
    it("is the target's own name, verbatim", () => {
        expect(gatewayTargetLabel({plane: "llm", name: "openai"})).toBe("openai")
        expect(gatewayTargetLabel({plane: "mcp", name: "acme-notion"})).toBe("acme-notion")
    })
})

describe("settle-output builders", () => {
    const target = {plane: "mcp" as const, name: "acme-notion"}

    it("connected output carries connected:true and the target back", () => {
        expect(gatewayConnectedOutput(target)).toEqual({connected: true, target})
    })

    it("declined output is connected:false with reason 'declined', before anything opens", () => {
        expect(gatewayDeclinedOutput(target)).toEqual({
            connected: false,
            target,
            reason: "declined",
        })
    })

    it("cancelled output is connected:false with reason 'cancelled' — the llm-drawer-closed-without-saving case", () => {
        expect(gatewayCancelledOutput(target)).toEqual({
            connected: false,
            target,
            reason: "cancelled",
        })
    })
})

describe("resolveCustomMcpEndpoint (WP19 repoint)", () => {
    const customEndpoint = {
        id: "ep-1",
        slug: "acme-notion",
        namespace: "custom",
        auth_mode: "oauth",
        data: {route: {base_url: "https://acme.example/mcp"}},
    } as unknown as MCPEndpoint

    const builtinEndpoint = {
        id: "ep-2",
        slug: "acme-notion",
        namespace: "builtin",
        auth_mode: "oauth",
        data: {route: {base_url: "composio://composio/notion/acme-notion"}},
    } as unknown as MCPEndpoint

    it("resolves a matching custom endpoint by slug", () => {
        const target = {plane: "mcp" as const, name: "acme-notion"}
        expect(resolveCustomMcpEndpoint([customEndpoint], target)).toBe(customEndpoint)
    })

    it("is null for an llm-plane target regardless of the endpoint list", () => {
        const target = {plane: "llm" as const, name: "acme-notion"}
        expect(resolveCustomMcpEndpoint([customEndpoint], target)).toBeNull()
    })

    it("is null when the only match is a builtin (Composio) endpoint, not custom — falls back to the catalog drawer", () => {
        const target = {plane: "mcp" as const, name: "acme-notion"}
        expect(resolveCustomMcpEndpoint([builtinEndpoint], target)).toBeNull()
    })

    it("is null when no endpoint matches the target's name at all", () => {
        const target = {plane: "mcp" as const, name: "unknown-server"}
        expect(resolveCustomMcpEndpoint([customEndpoint], target)).toBeNull()
    })

    it("is null when the endpoint list hasn't loaded yet", () => {
        const target = {plane: "mcp" as const, name: "acme-notion"}
        expect(resolveCustomMcpEndpoint(undefined, target)).toBeNull()
    })
})
