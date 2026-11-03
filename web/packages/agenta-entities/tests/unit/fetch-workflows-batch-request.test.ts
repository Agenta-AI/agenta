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
 * is: one row per workflow, grouped by artifact, for one workflow or several.
 */
describe("fetchWorkflowsBatch request", () => {
    beforeEach(() => {
        axiosPostMock.mockReset()
        axiosPostMock.mockResolvedValue({data: {count: 0, workflow_revisions: []}})
    })

    it("asks for the latest revision of one workflow", async () => {
        await fetchWorkflowsBatch("project-1", ["app-1"])

        expect(axiosPostMock).toHaveBeenCalledWith(
            "https://agenta.test/api/workflows/revisions/query",
            {workflow_refs: [{id: "app-1"}], grouping: {by: "artifact", get: "latest"}},
            {params: {project_id: "project-1"}},
        )
    })

    it("asks for the latest revision of each of several workflows", async () => {
        await fetchWorkflowsBatch("project-1", ["app-1", "app-2"])

        expect(axiosPostMock).toHaveBeenCalledWith(
            "https://agenta.test/api/workflows/revisions/query",
            {
                workflow_refs: [{id: "app-1"}, {id: "app-2"}],
                grouping: {by: "artifact", get: "latest"},
            },
            {params: {project_id: "project-1"}},
        )
    })
})
