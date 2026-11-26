import {beforeEach, describe, expect, it, vi} from "vitest"

const post = vi.fn()

vi.mock("@agenta/shared/api", async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>
    return {
        ...actual,
        axios: {post: (...args: unknown[]) => post(...args)},
        getAgentaApiUrl: () => "http://api.test",
    }
})

const {fetchWorkflowsBatch} = await import("../../src/workflow/api/api")

const revision = (workflowId: string, version: number) => ({
    id: `${workflowId}-v${version}`,
    workflow_id: workflowId,
    version,
    data: {},
})

describe("fetchWorkflowsBatch", () => {
    beforeEach(() => post.mockReset())

    it("asks the server for each workflow's latest revision, not every revision", async () => {
        post.mockResolvedValue({
            data: {
                count: 3,
                workflow_revisions: [revision("a", 4), revision("b", 2), revision("c", 7)],
            },
        })

        const result = await fetchWorkflowsBatch("proj-1", ["a", "b", "c"])

        expect(post.mock.calls[0][0]).toBe("http://api.test/workflows/revisions/query")
        expect(post.mock.calls[0][1]).toEqual({
            workflow_refs: [{id: "a"}, {id: "b"}, {id: "c"}],
            grouping: {by: "artifact", get: "latest"},
        })
        expect([...result.entries()].map(([id, rev]) => [id, rev.id])).toEqual([
            ["a", "a-v4"],
            ["b", "b-v2"],
            ["c", "c-v7"],
        ])
    })

    it("sends the same body for one workflow", async () => {
        post.mockResolvedValue({data: {count: 1, workflow_revisions: [revision("a", 4)]}})

        await fetchWorkflowsBatch("proj-1", ["a"])

        expect(post.mock.calls[0][1]).toEqual({
            workflow_refs: [{id: "a"}],
            grouping: {by: "artifact", get: "latest"},
        })
    })
})
