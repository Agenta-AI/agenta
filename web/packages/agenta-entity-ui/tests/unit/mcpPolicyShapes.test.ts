/**
 * The MCP catalogue meeting the integrations drawer's own partition and lookups.
 *
 * This is where the two halves of the data layer meet: the adapters live in `@agenta/entities` and
 * the grouping rules live beside the drawer, and nothing else proves they fit.
 */
import {
    fromGatewayPermissions,
    toCatalogTools,
    toGatewayPermissions,
    type McpServerPolicy,
} from "@agenta/entities/mcpEndpoint"
import {describe, expect, it} from "vitest"

import {
    partitionToolsByAccess,
    savedToolPermission,
} from "../../src/DrillInView/SchemaControls/integrationPolicy"

const tools = [
    {name: "list_issues", title: "List issues", annotations: {readOnlyHint: true}},
    {name: "list_teams", annotations: {readOnlyHint: true}},
    {name: "create_issue", title: "Create issue"},
    {name: "delete_issue", annotations: {readOnlyHint: false, destructiveHint: true}},
]

describe("toCatalogTools against the drawer's own partition", () => {
    it("is accepted unchanged by partitionToolsByAccess", () => {
        const {readOnly, write} = partitionToolsByAccess(toCatalogTools(tools))

        expect(readOnly.map((tool) => tool.key)).toEqual(["list_issues", "list_teams"])
        expect(write.map((tool) => tool.key)).toEqual(["create_issue", "delete_issue"])
    })

    it("is keyed so the drawer's own permission lookup finds the saved value", () => {
        // The lookup is by key. A catalogue keyed by the title would answer with the default for
        // every tool and show a policy nobody wrote.
        const permissions = toGatewayPermissions({tool_permissions: {create_issue: "deny"}})

        expect(savedToolPermission(permissions, toCatalogTools(tools)[2].key)).toBe("deny")
    })
})

describe("the write path back", () => {
    it("saves a per-tool change without disturbing the rest of the policy", () => {
        const policy: McpServerPolicy = {
            tools: {mode: "include", names: ["create_issue", "list_issues"]},
            permission: "ask",
        }
        const permissions = toGatewayPermissions(policy)

        expect(
            fromGatewayPermissions({...permissions, tools: {create_issue: "allow"}}, policy),
        ).toEqual({
            tools: {mode: "include", names: ["create_issue", "list_issues"]},
            permission: "ask",
            tool_permissions: {create_issue: "allow"},
        })
    })
})
