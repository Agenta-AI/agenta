import {beforeEach, describe, expect, it, vi} from "vitest"

import {
    projectHomeUrl,
    projectTemplateUrl,
    forgetTemplateKey,
    peekTemplateKey,
    rememberTemplateKey,
} from "../../src/lib/context"

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

describe("template key across sign-in", () => {
    beforeEach(() => {
        const store = new Map<string, string>()
        vi.stubGlobal("localStorage", {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => store.set(key, value),
            removeItem: (key: string) => store.delete(key),
        })
    })

    it("hands the key back on every read until the template screen forgets it", () => {
        rememberTemplateKey("issue-triage", 1_000)
        expect(peekTemplateKey(2_000)).toBe("issue-triage")
        expect(peekTemplateKey(3_000)).toBe("issue-triage")
        forgetTemplateKey()
        expect(peekTemplateKey(4_000)).toBe("")
    })

    it("drops a key older than the capture window", () => {
        rememberTemplateKey("issue-triage", 0)
        expect(peekTemplateKey(31 * 60 * 1000)).toBe("")
    })
})
