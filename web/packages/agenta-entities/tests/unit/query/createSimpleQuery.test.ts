import {describe, it, expect, vi, beforeEach} from "vitest"

// Regression guard for the live-eval create-path repoint (T1): the Online
// Evaluation drawer now creates queries through this mutation, so its request
// shape and revision resolution must stay stable.

const createSimpleQueryMock = vi.fn()
const retrieveQueryRevisionMock = vi.fn()

vi.mock("@agenta/sdk", () => ({
    getAgentaSdkClient: () => ({
        queries: {
            createSimpleQuery: createSimpleQueryMock,
            retrieveQueryRevision: retrieveQueryRevisionMock,
        },
    }),
}))

vi.mock("@agenta/shared/api", () => ({
    getAgentaApiUrl: () => "http://test",
}))

import {createSimpleQuery} from "../../../src/query/api/mutations"

describe("createSimpleQuery (live-eval repoint regression)", () => {
    beforeEach(() => {
        createSimpleQueryMock.mockReset()
        retrieveQueryRevisionMock.mockReset()
    })

    it("sends {query} with the project_id queryParam and returns ids from the create response", async () => {
        createSimpleQueryMock.mockResolvedValue({
            query: {id: "q1", variant_id: "v1", revision_id: "r1"},
        })

        const query = {name: "n", slug: "s", data: {filtering: {conditions: []}}}
        const result = await createSimpleQuery({projectId: "p1", query})

        expect(createSimpleQueryMock).toHaveBeenCalledWith(
            {query},
            {queryParams: {project_id: "p1"}},
        )
        // Head revision came inlined on the create response — no extra round-trip.
        expect(retrieveQueryRevisionMock).not.toHaveBeenCalled()
        expect(result).toEqual({queryId: "q1", variantId: "v1", revisionId: "r1"})
    })

    it("falls back to retrieveQueryRevision when the create response omits revision_id", async () => {
        createSimpleQueryMock.mockResolvedValue({query: {id: "q2", variant_id: "v2"}})
        retrieveQueryRevisionMock.mockResolvedValue({query_revision: {id: "r2"}})

        const result = await createSimpleQuery({projectId: "p1", query: {name: "n"}})

        expect(retrieveQueryRevisionMock).toHaveBeenCalledWith(
            {query_ref: {id: "q2"}},
            {queryParams: {project_id: "p1"}},
        )
        expect(result).toEqual({queryId: "q2", variantId: "v2", revisionId: "r2"})
    })

    it("throws when no query id is returned", async () => {
        createSimpleQueryMock.mockResolvedValue({query: null})

        await expect(createSimpleQuery({projectId: "p1", query: {}})).rejects.toThrow(
            /create query/i,
        )
    })

    it("throws when no revision can be resolved", async () => {
        createSimpleQueryMock.mockResolvedValue({query: {id: "q3"}})
        retrieveQueryRevisionMock.mockResolvedValue({query_revision: null})

        await expect(createSimpleQuery({projectId: "p1", query: {}})).rejects.toThrow(/revision/i)
    })
})
