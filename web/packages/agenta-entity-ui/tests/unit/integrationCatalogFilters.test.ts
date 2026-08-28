import {describe, expect, it} from "vitest"

import {
    catalogSections,
    filterConnectedGroups,
    matchesCategory,
} from "../../src/DrillInView/SchemaControls/agentTemplate/integrationCatalogFilters"

const DEV = {id: "developer-tools", name: "developer tools"}
const COMMS = {id: "communication", name: "communication"}

const groups = [
    {integrationKey: "github"},
    {integrationKey: "slack"},
    {integrationKey: "linear"},
]

const categoriesByIntegration = new Map<string, readonly string[]>([
    ["github", ["developer tools"]],
    ["slack", ["communication"]],
    ["linear", ["productivity"]],
])

const namesByIntegration = new Map([
    ["github", "GitHub"],
    ["slack", "Slack"],
    ["linear", "Linear"],
])

const keys = <T extends {integrationKey: string}>(rows: T[]) => rows.map((r) => r.integrationKey)

describe("matchesCategory", () => {
    it("matches on the provider's category name", () => {
        expect(matchesCategory(["developer tools"], DEV)).toBe(true)
    })

    it("matches on the rail's category id, which is the same thing slugified", () => {
        expect(matchesCategory(["developer-tools"], DEV)).toBe(true)
    })

    it("ignores case, because the provider sends these lowercase", () => {
        expect(matchesCategory(["Developer Tools"], DEV)).toBe(true)
    })

    it("does not match a different category", () => {
        expect(matchesCategory(["communication"], DEV)).toBe(false)
    })

    it("matches everything when no category is selected", () => {
        expect(matchesCategory([], null)).toBe(true)
        expect(matchesCategory(undefined, null)).toBe(true)
    })

    it("excludes an app with no categories once a category is picked", () => {
        expect(matchesCategory([], DEV)).toBe(false)
    })
})

describe("filterConnectedGroups", () => {
    const base = {groups, categoriesByIntegration, namesByIntegration}

    it("keeps every row with no search and no category", () => {
        expect(keys(filterConnectedGroups({...base, query: "", category: null}))).toEqual([
            "github",
            "slack",
            "linear",
        ])
    })

    it("filters the CONNECTED list by the selected category, not just the catalog", () => {
        expect(keys(filterConnectedGroups({...base, query: "", category: COMMS}))).toEqual(["slack"])
    })

    it("applies the search and the category together", () => {
        expect(keys(filterConnectedGroups({...base, query: "git", category: COMMS}))).toEqual([])
        expect(keys(filterConnectedGroups({...base, query: "git", category: DEV}))).toEqual([
            "github",
        ])
    })

    it("searches the display name too, not only the integration key", () => {
        expect(
            keys(
                filterConnectedGroups({
                    groups: [{integrationKey: "gcal"}],
                    categoriesByIntegration: new Map(),
                    namesByIntegration: new Map([["gcal", "Google Calendar"]]),
                    query: "calendar",
                    category: null,
                }),
            ),
        ).toEqual(["gcal"])
    })

    it("keeps a row whose catalog detail has not loaded yet, so rows do not blink out", () => {
        expect(
            keys(
                filterConnectedGroups({
                    groups: [{integrationKey: "notion"}],
                    categoriesByIntegration: new Map(),
                    namesByIntegration: new Map(),
                    query: "",
                    category: DEV,
                }),
            ),
        ).toEqual(["notion"])
    })
})

describe("catalogSections", () => {
    const integrations = [{key: "github"}, {key: "slack"}, {key: "notion"}]

    it("lists an already-connected integration in BOTH sections, so a second account is reachable", () => {
        const {connected, connectable} = catalogSections({
            integrations,
            groups,
            query: "",
            category: null,
            categoriesByIntegration,
            namesByIntegration,
        })

        expect(keys(connected)).toContain("github")
        expect(connectable.map((i) => i.key)).toContain("github")
    })

    it("does not subtract the connected apps from the catalog", () => {
        const {connectable} = catalogSections({
            integrations,
            groups,
            query: "",
            category: null,
            categoriesByIntegration,
            namesByIntegration,
        })

        expect(connectable.map((i) => i.key)).toEqual(["github", "slack", "notion"])
    })

    it("narrows only the connected section, since the catalog is filtered server-side", () => {
        const {connected, connectable} = catalogSections({
            integrations,
            groups,
            query: "",
            category: COMMS,
            categoriesByIntegration,
            namesByIntegration,
        })

        expect(keys(connected)).toEqual(["slack"])
        expect(connectable).toHaveLength(3)
    })
})
