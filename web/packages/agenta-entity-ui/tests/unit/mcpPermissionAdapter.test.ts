/**
 * The translation between what an MCP server saves and what the permission drawer authors.
 *
 * The drawer's vocabulary has a fourth value, `inherit`, that the MCP wire does not carry. The
 * whole design rests on that not being a loss: on this wire the ABSENCE of a value is the fourth
 * value. These cases are what holds that claim up, in both directions and for both levels.
 */
import {describe, expect, it} from "vitest"

import {
    DEFAULT_MCP_POLICY,
    fromGatewayPermissions,
    inheritOptionLabel,
    inheritedPermission,
    toCatalogTools,
    toGatewayPermissions,
} from "../../src/mcpEndpoint/mcpPermissionAdapter"
import {
    integrationPermissionSummary,
    partitionToolsByAccess,
} from "../../src/DrillInView/SchemaControls/integrationPolicy"
import type {McpServerPolicy} from "@agenta/entities/mcpEndpoint"

const roundTrip = (policy: McpServerPolicy): McpServerPolicy =>
    fromGatewayPermissions(toGatewayPermissions(policy), policy)

describe("the server's own permission", () => {
    it.each(["allow", "ask", "deny"] as const)("survives a round trip as %s", (permission) => {
        expect(roundTrip({permission})).toEqual({permission})
    })

    it("reads an absent permission as the fourth value", () => {
        // "Follows agent policy" is not stored; it is what nothing stored MEANS.
        expect(toGatewayPermissions({}).default).toBe("inherit")
    })

    it("writes the fourth value by removing the field, not by inventing one", () => {
        // A `permission: "inherit"` on the wire would fail the SDK's own model, which knows three
        // values. The absence is the only spelling that survives a save.
        const written = fromGatewayPermissions(
            {default: "inherit", tools: {}},
            {permission: "deny"},
        )

        expect(written).not.toHaveProperty("permission")
    })
})

describe("one tool's permission", () => {
    it("survives a round trip with its table intact", () => {
        const policy: McpServerPolicy = {
            permission: "ask",
            tool_permissions: {echo: "allow", wipe: "deny"},
        }

        expect(roundTrip(policy)).toEqual(policy)
    })

    it("reads a tool with no entry as the fourth value, not as the server's", () => {
        // Borrowing the server's value here would claim a rule the author never wrote, and would
        // go on claiming it after the server permission changed underneath.
        expect(toGatewayPermissions({permission: "allow"}).tools).toEqual({})
    })

    it("drops an entry set to the fourth value rather than writing it", () => {
        const written = fromGatewayPermissions(
            {default: "allow", tools: {echo: "inherit", wipe: "deny"}},
            {tool_permissions: {echo: "ask", wipe: "deny"}},
        )

        expect(written.tool_permissions).toEqual({wipe: "deny"})
    })
})

describe("the include filter", () => {
    it("is carried through untouched, because it is not a permission", () => {
        // `tools` decides what the server ADVERTISES. Rebuilding the policy without it would
        // quietly widen the server every time somebody picked a preset.
        const written = fromGatewayPermissions(
            {default: "deny", tools: {}},
            {tools: {mode: "include", names: ["echo"]}, permission: "allow"},
        )

        expect(written.tools).toEqual({mode: "include", names: ["echo"]})
    })
})

describe("emptying the table", () => {
    it("takes the new-tool floor with it", () => {
        // With no entries left there is no table for a floor to belong to. A `new_tool_permission`
        // left behind keeps per-tool mode switched on for a server whose author has just returned
        // it to a single rule, and an unnamed tool would go on resolving to the floor rather than
        // to the server permission.
        const written = fromGatewayPermissions(
            {default: "allow", tools: {}},
            {permission: "ask", new_tool_permission: "ask", tool_permissions: {echo: "deny"}},
        )

        expect(written).toEqual({permission: "allow"})
    })
})

describe("what an unnamed tool actually gets", () => {
    it("is the server permission while no table is declared", () => {
        expect(inheritedPermission({permission: "allow"})).toBe("allow")
    })

    it("is Ask once a table is declared, even beside an allow server", () => {
        // The runner's gate never consults the whole-server permission once a table exists: a
        // human decides for anything the table does not name. Reading `permission` here would
        // promise an unapproved run that will not happen (D88).
        expect(inheritedPermission({permission: "allow", tool_permissions: {echo: "allow"}})).toBe(
            "ask",
        )
    })

    it("is the declared floor when the author set one", () => {
        expect(inheritedPermission({new_tool_permission: "deny"})).toBe("deny")
    })

    it("is Ask when nothing at all is saved", () => {
        expect(inheritedPermission({})).toBe("ask")
    })

    it("is named on the row rather than left as a bare value", () => {
        expect(inheritOptionLabel({permission: "allow"})).toBe("Inherits allow")
    })
})

describe("the tool catalog the drawer lists", () => {
    it("keys a row by the name the server advertises, not by its title", () => {
        // The policy is keyed by the advertised name, and it is the only spelling every harness
        // agrees on. A row keyed by a title would write a rule no run could find.
        const [tool] = toCatalogTools([{name: "get_issue", title: "Get Linear issue"}])

        expect(tool.key).toBe("get_issue")
        expect(tool.name).toBe("Get Linear issue")
    })

    it("falls back to the advertised name when the server offers no title", () => {
        expect(toCatalogTools([{name: "echo"}])[0].name).toBe("echo")
    })

    it("puts a read-only tool in the read-only group and everything else in write", () => {
        const catalog = toCatalogTools([
            {name: "get_issue", annotations: {readOnlyHint: true}},
            {name: "delete_issue", annotations: {readOnlyHint: false}},
            // No annotation at all. A tool that does not say it is safe is not safe.
            {name: "mystery"},
        ])

        const {readOnly, write} = partitionToolsByAccess(catalog)

        expect(readOnly.map((tool) => tool.key)).toEqual(["get_issue"])
        expect(write.map((tool) => tool.key)).toEqual(["delete_issue", "mystery"])
    })

    it("leaves an absent hint absent rather than deciding it is false", () => {
        expect(toCatalogTools([{name: "mystery"}])[0].readOnly).toBeUndefined()
    })
})

describe("the policy a server is added with", () => {
    it("is Allow all, so a new server reads back as a preset somebody picked", () => {
        // An empty policy is not a neutral start on this wire: no `permission` MEANS "follows the
        // agent's policy", which reads back as a preset nobody chose.
        expect(integrationPermissionSummary(toGatewayPermissions(DEFAULT_MCP_POLICY)).label).toBe(
            "Allow all",
        )
    })

    it("is not what an empty policy reads back as", () => {
        expect(integrationPermissionSummary(toGatewayPermissions({})).label).not.toBe("Allow all")
    })
})
