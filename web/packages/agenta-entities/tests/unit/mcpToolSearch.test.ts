/**
 * Finding one tool among many, which is what a real provider's catalogue makes necessary:
 * Linear advertises seventy-nine and both lists rendered every row (UI QA round 3, scenario G).
 */
import {describe, expect, it} from "vitest"

import {filterMcpTools, TOOL_FILTER_THRESHOLD} from "../../src/mcpEndpoint/core/toolSearch"

const tools = [
    {name: "create_issue", description: "File a new issue in a team"},
    {name: "list_teams", description: "Every team in the workspace"},
    {name: "update_issue", description: "Change an existing issue"},
]

describe("filterMcpTools", () => {
    it("matches the name, whatever case it was typed in", () => {
        expect(filterMcpTools(tools, "ISSUE").map((tool) => tool.name)).toEqual([
            "create_issue",
            "update_issue",
        ])
    })

    it("matches the description too, because people search for what a tool does", () => {
        expect(filterMcpTools(tools, "workspace").map((tool) => tool.name)).toEqual(["list_teams"])
    })

    it("matches the title, which is the string the row actually shows", () => {
        // A row survives the filter only if it contains the typed text somewhere a person can read
        // it. Matching the name alone hid rows whose title was the only place the word appeared.
        const titled = [
            {name: "issue_create", title: "File a bug"},
            {name: "team_list", annotations: {title: "Every squad"}},
        ]

        expect(filterMcpTools(titled, "bug").map((tool) => tool.name)).toEqual(["issue_create"])
        expect(filterMcpTools(titled, "squad").map((tool) => tool.name)).toEqual(["team_list"])
    })

    it("is not a filter when nothing was typed", () => {
        expect(filterMcpTools(tools, "")).toHaveLength(3)
        expect(filterMcpTools(tools, "   ")).toHaveLength(3)
    })

    it("returns nothing rather than everything when nothing matches", () => {
        expect(filterMcpTools(tools, "deploy")).toEqual([])
    })

    it("tolerates a tool with no description at all", () => {
        expect(filterMcpTools([{name: "echo"}], "echo")).toHaveLength(1)
        expect(filterMcpTools([{name: "echo"}], "back")).toHaveLength(0)
    })

    it("keeps the threshold small enough to help and large enough not to nag", () => {
        // A box above three rows is noise; above seventy-nine it is the only way through.
        expect(TOOL_FILTER_THRESHOLD).toBeGreaterThan(3)
        expect(TOOL_FILTER_THRESHOLD).toBeLessThan(20)
    })
})
