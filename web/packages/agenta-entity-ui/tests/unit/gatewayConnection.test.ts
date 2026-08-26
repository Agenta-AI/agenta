/**
 * The saved `gateway_connection` entry — qa.md F10, F11, F12, F14, and F16.
 *
 * These cover the parts an author can lose silently: the read-only partition, a group rollup that
 * must NOT resolve `inherit`, a saved tool key the provider catalog dropped, and the connection
 * swap, which must replace the one entry the format allows rather than appending a second.
 */
import {describe, expect, it} from "vitest"

import {agentItemIdentity} from "@agenta/entities/workflow/commitDiff"

import {
    partitionToolsByAccess,
    rollupGroupPermission,
    rollupLabel,
    savedToolPermission,
    withStaleTools,
    type CatalogToolInfo,
} from "../../src/DrillInView/SchemaControls/integrationPolicy"
import {
    buildGatewayConnectionEntry,
    buildIntegrationRows,
    integrationRowIndices,
    parseGatewayConnection,
    removeIntegrationRow,
    upsertGatewayConnection,
    type GatewayConnectionPermissions,
    type ParsedGatewayConnection,
} from "../../src/DrillInView/SchemaControls/toolUtils"

const view = (
    overrides: Partial<ParsedGatewayConnection> = {},
): ParsedGatewayConnection => ({
    provider: "composio",
    integration: "github",
    connection: "github-work",
    permissions: {default: "deny", tools: {}},
    ...overrides,
})

const legacyTool = (name: string, permission?: string) => ({
    type: "function",
    function: {name},
    ...(permission ? {permission} : {}),
})

describe("parseGatewayConnection", () => {
    it("reads the saved entry from contracts section 1", () => {
        expect(
            parseGatewayConnection({
                type: "gateway_connection",
                connection: {provider: "composio", integration: "github", slug: "github-work"},
                policy: {
                    permissions: {
                        default: "deny",
                        tools: {
                            GET_ISSUE: "inherit",
                            CREATE_ISSUE: "ask",
                            DELETE_REPOSITORY: "deny",
                        },
                    },
                },
            }),
        ).toEqual(
            view({
                permissions: {
                    default: "deny",
                    tools: {GET_ISSUE: "inherit", CREATE_ISSUE: "ask", DELETE_REPOSITORY: "deny"},
                },
            }),
        )
    })

    it("refuses an entry missing a required routing field, rather than inventing one", () => {
        // contracts section 1 makes all three required, and the SDK refuses the same shape. A
        // repaired entry would look configured here and fail only when the agent runs.
        const missing = (connection: Record<string, unknown>) =>
            parseGatewayConnection({type: "gateway_connection", connection})
        expect(missing({integration: "github", slug: "work"})).toBe(null)
        expect(missing({provider: "composio", slug: "work"})).toBe(null)
        expect(missing({provider: "composio", integration: "github"})).toBe(null)
    })

    it("returns null for any other entry, including a legacy gateway one", () => {
        expect(parseGatewayConnection(legacyTool("tools__composio__github__GET_ISSUE__work"))).toBe(
            null,
        )
        expect(
            parseGatewayConnection({type: "gateway", integration: "github", action: "X", connection: "c"}),
        ).toBe(null)
        expect(parseGatewayConnection(null)).toBe(null)
    })

    it("reads an entry with no policy as the read-aware default", () => {
        const parsed = parseGatewayConnection({
            type: "gateway_connection",
            connection: {provider: "composio", integration: "linear", slug: "linear-main"},
        })
        expect(parsed?.permissions).toEqual({default: "inherit", tools: {}})
    })

    it("round trips through the builder", () => {
        const original = view({permissions: {default: "ask", tools: {GET_ISSUE: "allow"}}})
        expect(parseGatewayConnection(buildGatewayConnectionEntry(original))).toEqual(original)
    })
})

describe("a write applies to the entry as it was saved", () => {
    // The parser models only the fields this surface edits. Rebuilding the entry from that view
    // would drop everything else it carries, which is a silent rewrite of an author's config.
    const saved = {
        type: "gateway_connection",
        connection: {
            provider: "composio",
            integration: "github",
            slug: "github-work",
            note: "kept by hand",
        },
        policy: {permissions: {default: "deny", tools: {}}, note: "kept by hand"},
        render: {collapsed: true},
    }

    it("keeps fields the parser does not model", () => {
        const [next] = upsertGatewayConnection(
            [saved],
            view({connection: "github-personal", permissions: {default: "allow", tools: {}}}),
        ) as Record<string, unknown>[]
        expect(next.render).toEqual({collapsed: true})
        expect((next.policy as Record<string, unknown>).note).toBe("kept by hand")
        expect((next.connection as Record<string, unknown>).note).toBe("kept by hand")
    })

    it("still applies the change it was asked to make", () => {
        const [next] = upsertGatewayConnection(
            [saved],
            view({connection: "github-personal", permissions: {default: "allow", tools: {}}}),
        )
        expect(parseGatewayConnection(next)).toEqual(
            view({connection: "github-personal", permissions: {default: "allow", tools: {}}}),
        )
    })
})

describe("agentItemIdentity for an integration entry", () => {
    const entry = buildGatewayConnectionEntry(view())

    it("keys on the integration, not the position", () => {
        expect(agentItemIdentity("tool", entry, 0)).toBe("integration:composio:github")
        expect(agentItemIdentity("tool", entry, 7)).toBe("integration:composio:github")
    })

    it("gives two integrations two identities", () => {
        const other = buildGatewayConnectionEntry(view({integration: "linear", connection: "l"}))
        expect(agentItemIdentity("tool", other, 0)).not.toBe(agentItemIdentity("tool", entry, 0))
    })
})

describe("F10: the read-only and write partition", () => {
    const tools: CatalogToolInfo[] = [
        {key: "GET_ISSUE", readOnly: true},
        {key: "CREATE_ISSUE", readOnly: false},
        {key: "MYSTERY_TOOL"},
    ]

    it("comes from the catalog read_only flag", () => {
        const {readOnly, write} = partitionToolsByAccess(tools)
        expect(readOnly.map((t) => t.key)).toEqual(["GET_ISSUE"])
        expect(write.map((t) => t.key)).toEqual(["CREATE_ISSUE", "MYSTERY_TOOL"])
    })

    it("puts a tool with an absent flag in the write group", () => {
        const {write} = partitionToolsByAccess([{key: "MYSTERY_TOOL"}])
        expect(write.map((t) => t.key)).toEqual(["MYSTERY_TOOL"])
    })
})

describe("F11: a group rollup summarizes the saved values", () => {
    it("reports one shared value when the tools agree", () => {
        const permissions: GatewayConnectionPermissions = {default: "allow", tools: {}}
        const rollup = rollupGroupPermission(["GET_ISSUE", "LIST_ISSUES"], permissions)
        expect(rollup).toEqual({kind: "shared", permission: "allow"})
        expect(rollupLabel(rollup)).toBe("runs automatically")
    })

    it('a group saved inherit reads "follows agent policy" and is never resolved', () => {
        const permissions: GatewayConnectionPermissions = {
            default: "inherit",
            tools: {GET_ISSUE: "inherit"},
        }
        const rollup = rollupGroupPermission(["GET_ISSUE", "LIST_ISSUES"], permissions)
        // Resolving would need the agent-wide mode, which this layer does not own.
        expect(rollup).toEqual({kind: "shared", permission: "inherit"})
        expect(rollupLabel(rollup)).toBe("follows agent policy")
    })

    it("reports mixed when the saved values disagree", () => {
        const permissions: GatewayConnectionPermissions = {
            default: "inherit",
            tools: {DELETE_REPOSITORY: "deny"},
        }
        const rollup = rollupGroupPermission(["CREATE_ISSUE", "DELETE_REPOSITORY"], permissions)
        expect(rollup).toEqual({kind: "mixed"})
        expect(rollupLabel(rollup)).toBe("mixed")
    })

    it("a tool with no entry of its own reads the entry default", () => {
        const permissions: GatewayConnectionPermissions = {default: "ask", tools: {}}
        expect(savedToolPermission(permissions, "ANY_TOOL")).toBe("ask")
    })
})

describe("integration rows", () => {
    it("renders one row per integration from a connection entry", () => {
        const tools = [buildGatewayConnectionEntry(view())]
        const rows = buildIntegrationRows(tools)
        expect(rows).toHaveLength(1)
        expect(rows[0].integration).toBe("github")
        expect(rows[0].entryIndices).toEqual([0])
        expect(rows[0].legacyIndices).toEqual([])
    })

    it("F12: a legacy gateway entry group renders as ONE row carrying its legacy entries", () => {
        const tools = [
            legacyTool("tools__composio__github__GET_ISSUE__github-work"),
            legacyTool("tools__composio__github__CREATE_ISSUE__github-work"),
            {
                type: "gateway",
                provider: "composio",
                integration: "linear",
                action: "CREATE_ISSUE",
                connection: "linear-main",
            },
        ]
        const rows = buildIntegrationRows(tools)
        expect(rows.map((r) => r.integration)).toEqual(["github", "linear"])
        // The badge keys on this: the row has legacy entries and no connection entry.
        expect(rows[0].entry).toBe(null)
        expect(rows[0].legacyIndices).toEqual([0, 1])
        expect(rows[0].legacyConnections).toEqual(["github-work"])
        expect(rows[1].legacyIndices).toEqual([2])
    })

    it("a half-migrated integration is one row holding both formats", () => {
        const tools = [
            buildGatewayConnectionEntry(view()),
            legacyTool("tools__composio__github__GET_ISSUE__github-work"),
        ]
        const rows = buildIntegrationRows(tools)
        expect(rows).toHaveLength(1)
        expect(rows[0].entryIndices).toEqual([0])
        expect(rows[0].legacyIndices).toEqual([1])
    })

    it("leaves every other tool kind out of the rows", () => {
        const rows = buildIntegrationRows([
            {type: "function", function: {name: "my_tool"}},
            {type: "reference", slug: "wf"},
            {type: "web_search_preview"},
        ])
        expect(rows).toEqual([])
    })
})

describe("F14: a saved tool key absent from the catalog", () => {
    const saved = buildGatewayConnectionEntry(
        view({permissions: {default: "deny", tools: {RETIRED_TOOL: "allow", GET_ISSUE: "ask"}}}),
    )

    it("stays in the parsed policy", () => {
        expect(parseGatewayConnection(saved)?.permissions.tools).toEqual({
            RETIRED_TOOL: "allow",
            GET_ISSUE: "ask",
        })
    })

    it("is still shown as a row, marked stale, when the catalog no longer lists it", () => {
        const parsed = parseGatewayConnection(saved) as ParsedGatewayConnection
        const catalog: CatalogToolInfo[] = [{key: "GET_ISSUE", readOnly: true}]
        const listed = withStaleTools(catalog, parsed.permissions)
        expect(listed).toEqual([
            {key: "GET_ISSUE", readOnly: true},
            {key: "RETIRED_TOOL", stale: true},
        ])
        // An absent read_only flag puts it in the write group, next to the other unknowns.
        expect(partitionToolsByAccess(listed).write.map((t) => t.key)).toEqual(["RETIRED_TOOL"])
    })

    it("marks nothing stale when the catalog still lists every saved key", () => {
        const parsed = parseGatewayConnection(saved) as ParsedGatewayConnection
        const catalog: CatalogToolInfo[] = [{key: "GET_ISSUE"}, {key: "RETIRED_TOOL"}]
        expect(withStaleTools(catalog, parsed.permissions)).toEqual(catalog)
    })

    it("does not rewrite the config", () => {
        // Reading and writing the entry back preserves the key the catalog dropped.
        const parsed = parseGatewayConnection(saved)
        expect(buildGatewayConnectionEntry(parsed as ParsedGatewayConnection)).toEqual(saved)
    })
})

describe("F16: choosing a different connection for a configured integration", () => {
    const permissions: GatewayConnectionPermissions = {
        default: "ask",
        tools: {DELETE_REPOSITORY: "deny"},
    }
    const tools = [
        {type: "function", function: {name: "my_tool"}},
        buildGatewayConnectionEntry(view({permissions})),
    ]

    it("REPLACES the entry in one write and never appends a second", () => {
        const next = upsertGatewayConnection(tools, view({connection: "github-personal", permissions}))
        expect(next).toHaveLength(2)
        const rows = buildIntegrationRows(next)
        expect(rows).toHaveLength(1)
        expect(rows[0].entry?.connection).toBe("github-personal")
    })

    it("keeps the policy the author already set and swaps the slug alone", () => {
        const next = upsertGatewayConnection(tools, view({connection: "github-personal", permissions}))
        expect(parseGatewayConnection(next[1])?.permissions).toEqual(permissions)
    })

    it("keeps the entry in place rather than moving it to the end", () => {
        const next = upsertGatewayConnection(tools, view({connection: "github-personal", permissions}))
        expect(next[0]).toEqual(tools[0])
    })

    it("appends when the integration has no entry yet", () => {
        const next = upsertGatewayConnection([tools[0]], view())
        expect(next).toHaveLength(2)
        expect(parseGatewayConnection(next[1])?.integration).toBe("github")
    })

    it("adds a second entry for a DIFFERENT integration", () => {
        const next = upsertGatewayConnection(tools, view({integration: "linear", connection: "l"}))
        expect(buildIntegrationRows(next).map((r) => r.integration)).toEqual(["github", "linear"])
    })
})

describe("a revision that already holds two entries for one integration", () => {
    // The SDK refuses this shape, so it can only arrive by hand. The surface must not hide it,
    // and removing the integration must clear both — otherwise the row returns with a policy the
    // author believes they deleted.
    const duplicated = [
        buildGatewayConnectionEntry(view({permissions: {default: "deny", tools: {}}})),
        {type: "function", function: {name: "my_tool"}},
        buildGatewayConnectionEntry(view({connection: "other", permissions: {default: "allow", tools: {}}})),
    ]

    it("still reads as ONE row, holding both positions", () => {
        const rows = buildIntegrationRows(duplicated)
        expect(rows).toHaveLength(1)
        expect(rows[0].entryIndices).toEqual([0, 2])
        // The first entry is the one shown; the last must not silently win.
        expect(rows[0].entry?.connection).toBe("github-work")
    })

    it("is removed completely, not down to one leftover entry", () => {
        const [row] = buildIntegrationRows(duplicated)
        const next = removeIntegrationRow(duplicated, row)
        expect(next).toEqual([duplicated[1]])
        expect(buildIntegrationRows(next)).toEqual([])
    })

    it("removing an integration also clears its legacy entries", () => {
        const mixed = [
            buildGatewayConnectionEntry(view()),
            legacyTool("tools__composio__github__GET_ISSUE__github-work"),
            {type: "function", function: {name: "my_tool"}},
        ]
        const [row] = buildIntegrationRows(mixed)
        expect(removeIntegrationRow(mixed, row)).toEqual([mixed[2]])
    })

    it("reports every position the row occupies, entries and legacy alike", () => {
        const mixed = [
            ...duplicated,
            legacyTool("tools__composio__github__GET_ISSUE__github-work"),
        ]
        expect(integrationRowIndices(buildIntegrationRows(mixed)[0])).toEqual([0, 2, 3])
    })
})
