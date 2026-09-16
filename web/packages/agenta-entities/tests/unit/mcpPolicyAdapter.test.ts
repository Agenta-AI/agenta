/**
 * Translating one MCP policy into the shape the shared permission drawer edits, and back.
 *
 * Two features that save different shapes now drive one drawer, so every case here is a way the
 * translation could quietly say something the author did not: an inherit value written as a real
 * permission, a floor read as the whole-server rule, a tool filter dropped on the way back, a
 * policy rewritten by a drawer that was only opened.
 */
import {describe, expect, it} from "vitest"

import {
    fromGatewayPermissions,
    MCP_SUPPORTS_INHERIT,
    toGatewayPermissions,
} from "../../src/mcpEndpoint/core/policyAdapter"
import type {McpServerPolicy} from "../../src/mcpEndpoint/core/toolPolicy"

const roundTrip = (policy: McpServerPolicy) =>
    fromGatewayPermissions(toGatewayPermissions(policy), policy)

describe("toGatewayPermissions", () => {
    it("reads the whole-server permission as the default while no table is declared", () => {
        expect(toGatewayPermissions({permission: "allow"})).toEqual({default: "allow", tools: {}})
        expect(toGatewayPermissions({permission: "ask"})).toEqual({default: "ask", tools: {}})
        expect(toGatewayPermissions({permission: "deny"})).toEqual({default: "deny", tools: {}})
    })

    it("reads a policy with nothing written as inherit", () => {
        // Absence IS the inherit value: no `permission` leaves the run's own ladder deciding.
        expect(toGatewayPermissions({})).toEqual({default: "inherit", tools: {}})
        expect(toGatewayPermissions({permission: null})).toEqual({default: "inherit", tools: {}})
    })

    it("carries every per-tool entry through as it was saved", () => {
        expect(
            toGatewayPermissions({tool_permissions: {create_issue: "deny", list_teams: "allow"}})
                .tools,
        ).toEqual({create_issue: "deny", list_teams: "allow"})
    })

    it("reads the table's floor as the default once a table is declared", () => {
        // Not the server permission. The runner stops consulting it once a table exists, and
        // reading it here made the drawer promise that an unnamed tool would run unapproved (D88).
        expect(
            toGatewayPermissions({
                permission: "allow",
                tool_permissions: {create_issue: "deny"},
            }).default,
        ).toBe("ask")

        expect(
            toGatewayPermissions({
                permission: "allow",
                tool_permissions: {create_issue: "deny"},
                new_tool_permission: "deny",
            }).default,
        ).toBe("deny")
    })

    it("does not hand back the policy's own table to edit in place", () => {
        const policy: McpServerPolicy = {tool_permissions: {echo: "allow"}}
        toGatewayPermissions(policy).tools.echo = "deny"

        expect(policy.tool_permissions).toEqual({echo: "allow"})
    })
})

describe("fromGatewayPermissions", () => {
    it("writes each of the three values to the whole-server permission", () => {
        expect(fromGatewayPermissions({default: "allow", tools: {}}, {})).toEqual({
            permission: "allow",
        })
        expect(fromGatewayPermissions({default: "ask", tools: {}}, {})).toEqual({permission: "ask"})
        expect(fromGatewayPermissions({default: "deny", tools: {}}, {})).toEqual({
            permission: "deny",
        })
    })

    it("clears the permission rather than writing inherit", () => {
        // The only spelling MCP has for "let the agent policy decide" is the absent field.
        const next = fromGatewayPermissions({default: "inherit", tools: {}}, {permission: "deny"})

        expect(next).toEqual({})
        expect("permission" in next).toBe(false)
    })

    it("clears a tool's entry rather than writing inherit on it", () => {
        const next = fromGatewayPermissions(
            {default: "ask", tools: {create_issue: "inherit", list_teams: "deny"}},
            {tool_permissions: {create_issue: "allow", list_teams: "deny"}},
        )

        expect(next.tool_permissions).toEqual({list_teams: "deny"})
    })

    it("drops the table entirely when its last entry is cleared", () => {
        const next = fromGatewayPermissions(
            {default: "ask", tools: {create_issue: "inherit"}},
            {tool_permissions: {create_issue: "allow"}},
        )

        expect("tool_permissions" in next).toBe(false)
    })

    it("writes the default to the floor while a table is declared", () => {
        const next = fromGatewayPermissions(
            {default: "deny", tools: {create_issue: "allow"}},
            {permission: "allow", tool_permissions: {create_issue: "allow"}},
        )

        expect(next.new_tool_permission).toBe("deny")
        // The whole-server permission is not the floor and is not touched by a floor edit.
        expect(next.permission).toBe("allow")
    })

    it("keeps the tool filter and everything else the drawer cannot see", () => {
        const current: McpServerPolicy = {
            tools: {mode: "include", names: ["create_issue"]},
            permission: "ask",
        }

        expect(fromGatewayPermissions({default: "allow", tools: {}}, current).tools).toEqual({
            mode: "include",
            names: ["create_issue"],
        })
    })

    it("refuses to give a permission to a tool the filter hides", () => {
        // The SDK rejects the whole policy for such an entry, so writing one produces an agent
        // that fails on every run rather than once at save.
        const current: McpServerPolicy = {tools: {mode: "include", names: ["create_issue"]}}
        const next = fromGatewayPermissions(
            {default: "ask", tools: {create_issue: "allow", list_teams: "deny"}},
            current,
        )

        expect(next.tool_permissions).toEqual({create_issue: "allow"})
    })

    it("keeps a hidden entry that is already saved, so it can still be cleared", () => {
        const current: McpServerPolicy = {
            tools: {mode: "include", names: ["create_issue"]},
            tool_permissions: {list_teams: "deny"},
        }

        expect(
            fromGatewayPermissions({default: "ask", tools: {list_teams: "deny"}}, current)
                .tool_permissions,
        ).toEqual({list_teams: "deny"})
        expect(
            fromGatewayPermissions({default: "ask", tools: {list_teams: "inherit"}}, current)
                .tool_permissions,
        ).toBeUndefined()
    })

    it("writes nothing when the default did not change", () => {
        // Opening a drawer and closing it must not rewrite a policy: a floor that was implied
        // stays implied, rather than being spelled out as a new saved value.
        const current: McpServerPolicy = {tool_permissions: {create_issue: "deny"}}

        expect(
            fromGatewayPermissions({default: "ask", tools: {create_issue: "deny"}}, current),
        ).toEqual(current)
    })

    it("writes the default to the server permission once the table is gone", () => {
        // Clearing the last entry moves which slot governs: with nothing per-tool left, the value
        // the drawer is showing is the whole-server permission again. Measuring "did the default
        // change" against the policy as it ARRIVED would call this unchanged and save an inherit
        // where the drawer says ask.
        const next = fromGatewayPermissions(
            {default: "ask", tools: {create_issue: "inherit"}},
            {tool_permissions: {create_issue: "deny"}},
        )

        expect(next).toEqual({permission: "ask"})
    })

    it("keeps the per-tool opt-in when one tool's override is cleared", () => {
        // Clearing a tool is not opting out of per-tool policy. The floor still governs every tool
        // and still says the same thing, so nothing is rewritten.
        const current: McpServerPolicy = {
            tool_permissions: {create_issue: "deny"},
            new_tool_permission: "allow",
        }

        expect(
            fromGatewayPermissions({default: "allow", tools: {create_issue: "inherit"}}, current),
        ).toEqual({new_tool_permission: "allow"})
    })

    it("defaults to an empty policy when nothing was saved before", () => {
        expect(fromGatewayPermissions({default: "deny", tools: {}})).toEqual({permission: "deny"})
    })
})

describe("the round trip", () => {
    it("leaves each of the three values exactly as it was", () => {
        for (const permission of ["allow", "ask", "deny"] as const) {
            expect(roundTrip({permission})).toEqual({permission})
        }
    })

    it("leaves an empty policy empty", () => {
        expect(roundTrip({})).toEqual({})
    })

    it("leaves a declared table and its floor untouched", () => {
        const policy: McpServerPolicy = {
            permission: "allow",
            tool_permissions: {create_issue: "deny", list_teams: "allow"},
            new_tool_permission: "ask",
        }

        expect(roundTrip(policy)).toEqual(policy)
    })

    it("leaves a table with no floor of its own without inventing one", () => {
        const policy: McpServerPolicy = {tool_permissions: {create_issue: "deny"}}

        expect(roundTrip(policy)).toEqual(policy)
    })

    it("leaves a filtered policy's filter alone", () => {
        const policy: McpServerPolicy = {
            tools: {mode: "include", names: ["create_issue"]},
            tool_permissions: {create_issue: "ask"},
            new_tool_permission: "deny",
        }

        expect(roundTrip(policy)).toEqual(policy)
    })
})

describe("MCP_SUPPORTS_INHERIT", () => {
    it("says inherit is available, because absence expresses it", () => {
        expect(MCP_SUPPORTS_INHERIT).toBe(true)
    })

    it("does not promise inherit beside a declared table, which MCP cannot say", () => {
        // Declaring a table raises the floor to ask so a human sees a tool nobody has looked at.
        // An inherit default written against one therefore reads back as ask, deliberately.
        const next = fromGatewayPermissions(
            {default: "inherit", tools: {create_issue: "deny"}},
            {tool_permissions: {create_issue: "deny"}, new_tool_permission: "allow"},
        )

        expect(next.new_tool_permission).toBeUndefined()
        expect(toGatewayPermissions(next).default).toBe("ask")
    })
})
