import {describe, expect, it} from "vitest"

import {
    buildKitSkillId,
    buildKitToolId,
    filterDisabledBuildKitItems,
} from "../../src/workflow/state/buildKitItems"

const embed = (slug: string) => ({
    "@ag.embed": {"@ag.references": {workflow: {slug}}, "@ag.selector": {path: "parameters.tool"}},
})

const OVERLAY = {
    tools: [
        {type: "builtin", name: "read"},
        {type: "builtin", name: "bash"},
        {type: "platform", op: "commit_revision"},
        {type: "platform", op: "query_spans"},
        {...embed("__ag__request_connection"), name: "Request connection"},
    ],
    skills: [{...embed("__ag__build_an_agent"), name: "build-an-agent"}],
    sandbox: {permissions: {write_files: "allow"}},
}

describe("build-kit item identity", () => {
    it("ids a platform tool by its op and an embed by its workflow slug", () => {
        expect(buildKitToolId({type: "platform", op: "test_run"})).toBe("platform:test_run")
        expect(buildKitToolId(embed("__ag__request_input"))).toBe("workflow:__ag__request_input")
        expect(buildKitSkillId(embed("__ag__build_an_agent"))).toBe("workflow:__ag__build_an_agent")
    })

    it("reads an embed id off a workflow_revision reference too", () => {
        const byRevision = {
            "@ag.embed": {"@ag.references": {workflow_revision: {slug: "__ag__request_input"}}},
        }
        expect(buildKitToolId(byRevision)).toBe("workflow:__ag__request_input")
    })
})

describe("filterDisabledBuildKitItems", () => {
    it("drops disabled tools and skills across sections", () => {
        const next = filterDisabledBuildKitItems(OVERLAY, [
            "platform:commit_revision",
            "workflow:__ag__build_an_agent",
        ])

        expect(next.tools.map(buildKitToolId)).toEqual([
            "name:read",
            "name:bash",
            "platform:query_spans",
            "workflow:__ag__request_connection",
        ])
        expect(next.skills).toEqual([])
        expect(next.sandbox).toEqual(OVERLAY.sandbox)
    })

    it("keeps the forced builtin grants whatever is disabled", () => {
        const next = filterDisabledBuildKitItems(OVERLAY, ["name:read", "name:bash"])
        expect(next.tools.filter((tool: any) => tool.type === "builtin")).toEqual([
            {type: "builtin", name: "read"},
            {type: "builtin", name: "bash"},
        ])
    })

    it("returns the overlay untouched when nothing is disabled", () => {
        expect(filterDisabledBuildKitItems(OVERLAY, [])).toBe(OVERLAY)
    })

    it("does not mutate the overlay it filters", () => {
        const before = JSON.parse(JSON.stringify(OVERLAY))
        filterDisabledBuildKitItems(OVERLAY, ["platform:query_spans"])
        expect(OVERLAY).toEqual(before)
    })
})
