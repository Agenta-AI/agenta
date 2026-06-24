import {describe, it, expect, vi, beforeEach} from "vitest"

// Regression guard for the registry commit modal: edits commit a new revision via
// the git endpoint with a commit message + the head variant id.

const commitQueryRevisionMock = vi.fn()

vi.mock("@agenta/sdk", () => ({
    getAgentaSdkClient: () => ({
        queries: {commitQueryRevision: commitQueryRevisionMock},
    }),
}))

vi.mock("@agenta/shared/api", () => ({
    getAgentaApiUrl: () => "http://test",
}))

import {commitQueryRevision} from "../../../src/query/api/mutations"

describe("commitQueryRevision", () => {
    beforeEach(() => {
        commitQueryRevisionMock.mockReset()
        commitQueryRevisionMock.mockResolvedValue({})
    })

    it("commits to the head variant with data, name, and message", async () => {
        await commitQueryRevision({
            projectId: "p1",
            variantId: "v1",
            data: {filtering: {conditions: []}},
            name: "test-3",
            message: "tightened the filter",
        })

        expect(commitQueryRevisionMock).toHaveBeenCalledWith(
            {
                query_revision: {
                    variant_id: "v1",
                    data: {filtering: {conditions: []}},
                    name: "test-3",
                    message: "tightened the filter",
                },
            },
            {queryParams: {project_id: "p1"}},
        )
    })

    it("omits the message when none is given", async () => {
        await commitQueryRevision({projectId: "p1", variantId: "v1", data: {}})

        const [payload] = commitQueryRevisionMock.mock.calls[0]
        expect(payload.query_revision).not.toHaveProperty("message")
        expect(payload.query_revision.variant_id).toBe("v1")
    })
})
