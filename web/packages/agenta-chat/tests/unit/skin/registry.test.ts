import {describe, expect, it} from "vitest"

import {
    hasClientToolWidget,
    registerChatSkin,
    resolveApprovalBody,
    resolveClientToolWidget,
    resolveToolDisplay,
} from "../../../src/skin/registry"
import type {ClientToolWidget} from "../../../src/skin/types"

// Registrations mutate a module-level store shared across this file's tests (documented merge
// semantics: later registration wins per key), so every test below uses its own unique key(s) to
// stay independent of test order.
const widget = (id: string): ClientToolWidget => {
    const Widget = () => null
    Widget.displayName = id
    return Widget
}

describe("clientTools registry", () => {
    it("round-trips a render-kind registration", () => {
        const w = widget("A")
        registerChatSkin({clientTools: {byRenderKind: {rt_elicitation: w}}})
        expect(resolveClientToolWidget({toolName: "unrelated", renderKind: "rt_elicitation"})).toBe(
            w,
        )
    })

    it("round-trips a tool-name registration", () => {
        const w = widget("B")
        registerChatSkin({clientTools: {byToolName: {rt_tool_name_1: w}}})
        expect(resolveClientToolWidget({toolName: "rt_tool_name_1"})).toBe(w)
    })

    it("prefers render.kind over toolName when both are registered (real OSS precedence)", () => {
        const byKind = widget("kind")
        const byName = widget("name")
        registerChatSkin({
            clientTools: {
                byRenderKind: {rt_precedence_kind: byKind},
                byToolName: {rt_precedence_name: byName},
            },
        })
        const resolved = resolveClientToolWidget({
            toolName: "rt_precedence_name",
            renderKind: "rt_precedence_kind",
        })
        expect(resolved).toBe(byKind)
    })

    it("falls back to toolName when renderKind is absent", () => {
        const w = widget("fallback")
        registerChatSkin({clientTools: {byToolName: {rt_fallback_tool: w}}})
        expect(resolveClientToolWidget({toolName: "rt_fallback_tool"})).toBe(w)
    })

    it("does not reinterpret an explicit unknown render kind by tool name", () => {
        const w = widget("fallback")
        registerChatSkin({clientTools: {byToolName: {rt_explicit_tool: w}}})
        expect(
            resolveClientToolWidget({toolName: "rt_explicit_tool", renderKind: "rt_unregistered"}),
        ).toBeUndefined()
    })

    it("resolves to undefined for a completely unregistered tool", () => {
        expect(resolveClientToolWidget({toolName: "rt_never_registered"})).toBeUndefined()
    })

    it("hasClientToolWidget mirrors resolveClientToolWidget", () => {
        const w = widget("has")
        registerChatSkin({clientTools: {byToolName: {rt_has_tool: w}}})
        expect(hasClientToolWidget({toolName: "rt_has_tool"})).toBe(true)
        expect(hasClientToolWidget({toolName: "rt_has_tool_missing"})).toBe(false)
    })

    it("a later registration wins over an earlier one for the same key", () => {
        const first = widget("first")
        const second = widget("second")
        registerChatSkin({clientTools: {byToolName: {rt_wins: first}}})
        expect(resolveClientToolWidget({toolName: "rt_wins"})).toBe(first)
        registerChatSkin({clientTools: {byToolName: {rt_wins: second}}})
        expect(resolveClientToolWidget({toolName: "rt_wins"})).toBe(second)
    })
})

describe("approvals registry", () => {
    it("round-trips a registration and resolves it by tool name", () => {
        const Body = () => null
        registerChatSkin({approvals: {ap_commit: {Body, headline: null, approveLabel: "Approve"}}})
        const entry = resolveApprovalBody("ap_commit")
        expect(entry?.Body).toBe(Body)
        expect(entry?.headline).toBeNull()
        expect(entry?.approveLabel).toBe("Approve")
    })

    it("resolves undefined for an unregistered tool name (generic card)", () => {
        expect(resolveApprovalBody("ap_never_registered")).toBeUndefined()
    })

    it("a later registration wins over an earlier one for the same tool name", () => {
        const First = () => null
        const Second = () => null
        registerChatSkin({approvals: {ap_wins: {Body: First}}})
        expect(resolveApprovalBody("ap_wins")?.Body).toBe(First)
        registerChatSkin({approvals: {ap_wins: {Body: Second}}})
        expect(resolveApprovalBody("ap_wins")?.Body).toBe(Second)
    })
})

describe("toolDisplay registry — resolveToolDisplay fallback chain", () => {
    it("pins the gateway `tools__provider__integration__ACTION__connection` prettification", () => {
        const display = resolveToolDisplay("tools__composio__gmail__ADD_LABEL__b81")
        expect(display).toEqual({
            raw: "tools__composio__gmail__ADD_LABEL__b81",
            kind: "gateway",
            label: "Add label",
            source: "Gmail",
            summary: undefined,
        })
    })

    it("pins the mcp__{server}__{tool} prettification", () => {
        const display = resolveToolDisplay("mcp__linear__search_issues")
        expect(display).toEqual({
            raw: "mcp__linear__search_issues",
            kind: "mcp",
            label: "Search issues",
            source: "Linear · MCP",
            summary: undefined,
        })
    })

    it("pins the plain-name title-case fallback with no source (platform kind)", () => {
        const display = resolveToolDisplay("search")
        expect(display).toEqual({
            raw: "search",
            kind: "platform",
            label: "Search",
            source: undefined,
            summary: undefined,
        })
    })

    it("merges a registered override with the parsed fallback, piece by piece", () => {
        const summary = (input: unknown) => (typeof input === "string" ? input : null)
        registerChatSkin({toolDisplay: {td_commit_like: {summary}}})
        const display = resolveToolDisplay("td_commit_like")
        // label/source/kind still come from the parsed name shape — only summary was overridden.
        expect(display.label).toBe("Td commit like")
        expect(display.kind).toBe("platform")
        expect(display.summary).toBe(summary)
    })

    it("a later registration wins over an earlier one for the same raw name", () => {
        registerChatSkin({toolDisplay: {td_wins: {label: "First"}}})
        expect(resolveToolDisplay("td_wins").label).toBe("First")
        registerChatSkin({toolDisplay: {td_wins: {label: "Second"}}})
        expect(resolveToolDisplay("td_wins").label).toBe("Second")
    })
})
