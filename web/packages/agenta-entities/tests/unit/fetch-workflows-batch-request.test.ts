import {beforeEach, describe, expect, it, vi} from "vitest"

const {axiosPostMock} = vi.hoisted(() => ({axiosPostMock: vi.fn()}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: {post: axiosPostMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {fetchWorkflowsBatch} from "../../src/workflow/api/api"

/**
 * `fetchWorkflowsBatch` feeds the latest-revision query that /w reads. Its request must stay as it
 * is: one workflow asks for the newest revision only, several ask for every revision.
 */
describe("fetchWorkflowsBatch request", () => {
    beforeEach(() => {
        axiosPostMock.mockReset()
        axiosPostMock.mockResolvedValue({data: {count: 0, workflow_revisions: []}})
    })

    it("asks for the newest revision of one workflow", async () => {
        await fetchWorkflowsBatch("project-1", ["app-1"])

        expect(axiosPostMock).toHaveBeenCalledWith(
            "https://agenta.test/api/workflows/revisions/query",
            {workflow_refs: [{id: "app-1"}], windowing: {limit: 1, order: "descending"}},
            {params: {project_id: "project-1"}},
        )
    })

    it("asks for every revision of several workflows, with no limit and no grouping", async () => {
        await fetchWorkflowsBatch("project-1", ["app-1", "app-2"])

        expect(axiosPostMock).toHaveBeenCalledWith(
            "https://agenta.test/api/workflows/revisions/query",
            {workflow_refs: [{id: "app-1"}, {id: "app-2"}]},
            {params: {project_id: "project-1"}},
        )
    })
})
