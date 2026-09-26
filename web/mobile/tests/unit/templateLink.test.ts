import {describe, expect, it} from "vitest"

import {projectHomeUrl, projectTemplateUrl} from "../../src/lib/context"

describe("projectTemplateUrl", () => {
    it("lands a website template link on that template's create step", () => {
        expect(projectTemplateUrl({workspaceId: "ws1", projectId: "pr1"}, "pr-reviewer")).toBe(
            "/w/ws1/p/pr1/agents/new?template=pr-reviewer",
        )
    })

    it("encodes the key and leaves the project home unchanged", () => {
        const context = {workspaceId: "ws1", projectId: "pr1"}
        expect(projectTemplateUrl(context, "a b")).toBe("/w/ws1/p/pr1/agents/new?template=a%20b")
        expect(projectHomeUrl(context)).toBe("/w/ws1/p/pr1/apps")
    })
})
