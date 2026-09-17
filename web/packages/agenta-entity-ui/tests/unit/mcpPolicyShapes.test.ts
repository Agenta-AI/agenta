/**
 * The MCP catalogue meeting the integrations drawer's own partition and lookups.
 *
 * This is where the two halves of the data layer meet: the adapters live in `@agenta/entities` and
 * the grouping rules live beside the drawer, and nothing else proves they fit. The assignability
 * cases are here for the same reason. Each package declares the drawer's shapes, because the
 * dependency runs one way only, and a field added to one and not the other has to fail a test
 * rather than diverge quietly.
 */
import {
    fromGatewayPermissions,
    toCatalogTools,
    toGatewayPermissions,
    type GatewayConnectionPermissions as EntitiesPermissions,
    type McpCatalogTool,
    type McpServerPolicy,
} from "@agenta/entities/mcpEndpoint"
import {describe, expect, it} from "vitest"

import {
    partitionToolsByAccess,
    savedToolPermission,
    type CatalogToolInfo,
} from "../../src/DrillInView/SchemaControls/integrationPolicy"
import type {GatewayConnectionPermissions} from "../../src/DrillInView/SchemaControls/toolUtils"

const tools = [
    {name: "list_issues", title: "List issues", annotations: {readOnlyHint: true}},
    {name: "list_teams", annotations: {readOnlyHint: true}},
    {name: "create_issue", title: "Create issue"},
    {name: "delete_issue", annotations: {readOnlyHint: false, destructiveHint: true}},
]

describe("the shapes the two packages each declare", () => {
    it("assigns a catalogue row either way", () => {
        const fromEntities: McpCatalogTool = {key: "echo", name: "Echo", readOnly: true}
        const asDrawerRow: CatalogToolInfo = fromEntities
        const backAgain: McpCatalogTool = asDrawerRow

        expect(backAgain).toBe(fromEntities)
    })

    it("assigns a permissions record either way", () => {
        const fromEntities: EntitiesPermissions = {default: "ask", tools: {echo: "allow"}}
        const asDrawerPermissions: GatewayConnectionPermissions = fromEntities
        const backAgain: EntitiesPermissions = asDrawerPermissions

        expect(backAgain).toBe(fromEntities)
    })
})

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
