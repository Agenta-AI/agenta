import {describe, it, expect, vi, beforeEach} from "vitest"

// Regression guard for the Active/Archived tabs: the Archived tab depends on the
// list passing `include_archived` and on the unarchive (restore) mutation sending
// the right request shape.

const querySimpleQueriesMock = vi.fn()
const unarchiveSimpleQueryMock = vi.fn()

vi.mock("@agenta/sdk", () => ({
    getAgentaSdkClient: () => ({
        queries: {
            querySimpleQueries: querySimpleQueriesMock,
            unarchiveSimpleQuery: unarchiveSimpleQueryMock,
        },
    }),
}))

vi.mock("@agenta/shared/api", () => ({
    getAgentaApiUrl: () => "http://test",
}))

import {querySimpleQueries} from "../../../src/query/api/api"
import {unarchiveSimpleQuery} from "../../../src/query/api/mutations"

describe("query archived-tab contracts", () => {
    beforeEach(() => {
        querySimpleQueriesMock.mockReset()
        unarchiveSimpleQueryMock.mockReset()
    })

    it("omits include_archived for the active list", async () => {
        querySimpleQueriesMock.mockResolvedValue({queries: [], count: 0})

        await querySimpleQueries({projectId: "p1"})

        expect(querySimpleQueriesMock).toHaveBeenCalledWith({}, {queryParams: {project_id: "p1"}})
    })

    it("sends include_archived when archived rows are requested", async () => {
        querySimpleQueriesMock.mockResolvedValue({queries: [], count: 0})

        await querySimpleQueries({
            projectId: "p1",
            includeArchived: true,
            windowing: {limit: 50, order: "descending"},
        })

        expect(querySimpleQueriesMock).toHaveBeenCalledWith(
            {include_archived: true, windowing: {limit: 50, order: "descending"}},
            {queryParams: {project_id: "p1"}},
        )
    })

    it("restores a query via unarchive with the project_id queryParam", async () => {
        unarchiveSimpleQueryMock.mockResolvedValue(undefined)

        await unarchiveSimpleQuery({projectId: "p1", queryId: "q9"})

        expect(unarchiveSimpleQueryMock).toHaveBeenCalledWith(
            {query_id: "q9"},
            {queryParams: {project_id: "p1"}},
        )
    })
})
