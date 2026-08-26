/**
 * Migration from legacy per-action entries to one `gateway_connection` entry — qa.md C31 to C33,
 * F13, F17, and G5.
 *
 * Both legacy encodings must migrate to the same result. The frontend has never written the
 * documented `{type: "gateway", action}` shape: the add drawer wrote a function entry whose name is
 * the five-segment slug. A migration that read only the documented shape would silently drop most
 * real agents' tools.
 */
import {describe, expect, it} from "vitest"

import {
    canMigrateIntegration,
    migrateIntegration,
} from "../../src/DrillInView/SchemaControls/gatewayMigration"
import {
    buildIntegrationRows,
    findIntegrationRow,
    parseGatewayConnection,
    buildGatewayConnectionEntry,
} from "../../src/DrillInView/SchemaControls/toolUtils"

const github = {provider: "composio", integration: "github"}

/** The row a migration would act on, the way the drawer's open handler finds it. */
const githubRow = (tools: unknown[]) => findIntegrationRow(buildIntegrationRows(tools), github)

const hasLegacyEntries = (tools: unknown[]) => (githubRow(tools)?.legacyIndices.length ?? 0) > 0

/** The legacy encoding the add drawer actually wrote. */
const slugTool = (action: string, connection: string, permission?: string) => ({
    type: "function",
    function: {name: `tools__composio__github__${action}__${connection}`},
    ...(permission ? {permission} : {}),
})

/** The legacy encoding `data-model.md` documents. */
const objectTool = (action: string, connection: string, permission?: string) => ({
    type: "gateway",
    provider: "composio",
    integration: "github",
    action,
    connection,
    ...(permission ? {permission} : {}),
})

describe("C31: grouping legacy entries into one entry", () => {
    it("entries sharing provider, integration, and connection become one entry with default deny", () => {
        const tools = [
            slugTool("GET_ISSUE", "github-work", "allow"),
            slugTool("CREATE_ISSUE", "github-work", "ask"),
        ]
        const next = migrateIntegration(tools, github)
        expect(next).toHaveLength(1)
        expect(parseGatewayConnection(next?.[0])).toEqual({
            provider: "composio",
            integration: "github",
            connection: "github-work",
            permissions: {default: "deny", tools: {GET_ISSUE: "allow", CREATE_ISSUE: "ask"}},
        })
    })

    it("reads BOTH legacy encodings to the same result", () => {
        const fromSlugs = migrateIntegration(
            [slugTool("GET_ISSUE", "github-work", "allow"), slugTool("CREATE_ISSUE", "github-work")],
            github,
        )
        const fromObjects = migrateIntegration(
            [
                objectTool("GET_ISSUE", "github-work", "allow"),
                objectTool("CREATE_ISSUE", "github-work"),
            ],
            github,
        )
        expect(fromSlugs).toEqual(fromObjects)
    })

    it("takes the position of the first legacy entry and leaves the other tools alone", () => {
        const custom = {type: "function", function: {name: "my_tool"}}
        const tail = {type: "reference", slug: "wf"}
        const next = migrateIntegration(
            [custom, slugTool("GET_ISSUE", "github-work"), tail, slugTool("X", "github-work")],
            github,
        )
        expect(next).toHaveLength(3)
        expect(next?.[0]).toEqual(custom)
        expect(parseGatewayConnection(next?.[1])?.integration).toBe("github")
        expect(next?.[2]).toEqual(tail)
    })

    it("leaves another integration's entries untouched", () => {
        const linear = {
            type: "gateway",
            provider: "composio",
            integration: "linear",
            action: "CREATE_ISSUE",
            connection: "linear-main",
        }
        const next = migrateIntegration([slugTool("GET_ISSUE", "github-work"), linear], github)
        expect(next?.[1]).toEqual(linear)
    })

    it("returns null when the integration has no legacy entries", () => {
        expect(migrateIntegration([{type: "function", function: {name: "x"}}], github)).toBe(null)
    })

    it("returns null when the integration already has a connection entry", () => {
        const tools = [
            buildGatewayConnectionEntry({
                provider: "composio",
                integration: "github",
                connection: "github-work",
                permissions: {default: "allow", tools: {}},
            }),
            slugTool("GET_ISSUE", "github-work"),
        ]
        // Folding the legacy tools in would change a policy the author already set. Leave both.
        expect(migrateIntegration(tools, github)).toBe(null)
        expect(canMigrateIntegration(githubRow(tools))).toBe(false)
    })
})

describe("C32 and C33: the per-tool permission", () => {
    it("C32: a legacy entry with no permission maps to inherit", () => {
        const next = migrateIntegration([slugTool("GET_ISSUE", "github-work")], github)
        expect(parseGatewayConnection(next?.[0])?.permissions.tools).toEqual({
            GET_ISSUE: "inherit",
        })
    })

    it('C33: a legacy entry with permission "allow" maps to allow', () => {
        const next = migrateIntegration([slugTool("GET_ISSUE", "github-work", "allow")], github)
        expect(parseGatewayConnection(next?.[0])?.permissions.tools).toEqual({GET_ISSUE: "allow"})
    })

    it("keeps the FIRST value when a revision lists the same action twice", () => {
        // Order must not decide which of two authored values survives.
        const next = migrateIntegration(
            [slugTool("GET_ISSUE", "github-work", "allow"), slugTool("GET_ISSUE", "github-work", "deny")],
            github,
        )
        expect(parseGatewayConnection(next?.[0])?.permissions.tools).toEqual({GET_ISSUE: "allow"})
    })

    it("keeps ask and deny as they were", () => {
        const next = migrateIntegration(
            [slugTool("CREATE_ISSUE", "w", "ask"), slugTool("DELETE_REPO", "w", "deny")],
            github,
        )
        expect(parseGatewayConnection(next?.[0])?.permissions.tools).toEqual({
            CREATE_ISSUE: "ask",
            DELETE_REPO: "deny",
        })
    })
})

describe("F13: a migrated group reads back what it was saved with", () => {
    it("every tool keeps its permission and no tool is added or lost", () => {
        const tools = [
            slugTool("GET_ISSUE", "github-work", "allow"),
            slugTool("CREATE_ISSUE", "github-work", "ask"),
            slugTool("LIST_ISSUES", "github-work"),
        ]
        const next = migrateIntegration(tools, github)
        const permissions = parseGatewayConnection(next?.[0])?.permissions
        expect(permissions).toEqual({
            default: "deny",
            tools: {GET_ISSUE: "allow", CREATE_ISSUE: "ask", LIST_ISSUES: "inherit"},
        })
        // Nothing outside the listed tools becomes reachable: the default denies the rest.
        expect(permissions?.default).toBe("deny")
    })
})

describe("G5: the row for a legacy group", () => {
    it("carries legacy entries before migration and none after", () => {
        const tools = [slugTool("GET_ISSUE", "github-work")]
        expect(hasLegacyEntries(tools)).toBe(true)
        const next = migrateIntegration(tools, github) as unknown[]
        expect(hasLegacyEntries(next)).toBe(false)
    })
})

describe("F17: an integration whose legacy entries name two connections", () => {
    const tools = [
        slugTool("GET_ISSUE", "github-work", "allow"),
        slugTool("CREATE_ISSUE", "github-personal", "ask"),
        {
            type: "gateway",
            provider: "composio",
            integration: "linear",
            action: "CREATE_ISSUE",
            connection: "linear-main",
            permission: "ask",
        },
    ]

    it("is NOT migrated", () => {
        expect(canMigrateIntegration(githubRow(tools))).toBe(false)
        expect(migrateIntegration(tools, github)).toBe(null)
    })

    it("keeps its legacy entries exactly as they are and keeps the badge", () => {
        const row = githubRow(tools)
        expect(row?.legacyConnections).toEqual(["github-work", "github-personal"])
        expect(hasLegacyEntries(tools)).toBe(true)
        expect(row?.entry).toBe(null)
    })

    it("other integrations in the same revision migrate normally", () => {
        const next = migrateIntegration(tools, {provider: "composio", integration: "linear"})
        expect(parseGatewayConnection(next?.[2])).toEqual({
            provider: "composio",
            integration: "linear",
            connection: "linear-main",
            permissions: {default: "deny", tools: {CREATE_ISSUE: "ask"}},
        })
        // The GitHub entries are untouched, byte for byte.
        expect(next?.[0]).toEqual(tools[0])
        expect(next?.[1]).toEqual(tools[1])
    })
})
