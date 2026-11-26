import {beforeEach, describe, expect, it, vi} from "vitest"

const createFromFile = vi.fn()
const editFromFile = vi.fn()
const queryTestsets = vi.fn()
const queryRuns = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getTestsetsClient: () => ({
        createSimpleTestsetFromFile: createFromFile,
        editSimpleTestsetFromFile: editFromFile,
        queryTestsets,
    }),
    getEvaluationsClient: () => ({queryRuns}),
}))

import {
    fetchEvaluationRunIdsUsingTestsets,
    queryTestsetsPage,
    uploadTestsetFile,
    uploadTestsetRevisionFile,
} from "../../src/testset/api"

beforeEach(() => {
    for (const mock of [createFromFile, editFromFile, queryTestsets, queryRuns]) mock.mockReset()
})

const csvFile = () => new File(["a,b\n1,2"], "data.csv", {type: "text/csv"})

describe("uploadTestsetFile", () => {
    it("Upload as a new testset posts the file, the type and the name as multipart form data", async () => {
        createFromFile.mockResolvedValueOnce({testset: {id: "t1", revision_id: "r1"}})
        const file = csvFile()
        await uploadTestsetFile({projectId: "p1", file, fileType: "csv", testsetName: "My Testset"})

        const [body, options] = createFromFile.mock.calls[0]
        expect(body).toEqual({file, file_type: "csv", testset_name: "My Testset"})
        expect(options).toEqual({queryParams: {project_id: "p1"}})
    })

    it("Upload as a new testset returns the new revision id", async () => {
        createFromFile.mockResolvedValueOnce({testset: {id: "t1", revision_id: "r1"}})
        const result = await uploadTestsetFile({projectId: "p1", file: csvFile(), fileType: "csv"})
        expect(result).toEqual({testsetId: "t1", revisionId: "r1"})
        expect(createFromFile.mock.calls[0][0]).not.toHaveProperty("testset_name")
    })
})

describe("uploadTestsetRevisionFile", () => {
    it("Upload as a new revision posts to the testset upload path", async () => {
        editFromFile.mockResolvedValueOnce({testset: {id: "t1", revision_id: "r2"}})
        const file = csvFile()
        const result = await uploadTestsetRevisionFile({
            projectId: "p1",
            testsetId: "t1",
            file,
            fileType: "json",
        })
        const [body, options] = editFromFile.mock.calls[0]
        expect(body).toEqual({testset_id: "t1", file, file_type: "json"})
        expect(options).toEqual({queryParams: {project_id: "p1"}})
        expect(result).toEqual({revisionId: "r2"})
    })
})

describe("queryTestsetsPage", () => {
    it("Testset page query sends the name filter in the body, not the URL", async () => {
        queryTestsets.mockResolvedValueOnce({testsets: [], count: 0})
        await queryTestsetsPage({projectId: "p1", limit: 50, name: "abc", includeArchived: true})
        const [body, options] = queryTestsets.mock.calls[0]
        expect(options).toEqual({queryParams: {project_id: "p1"}})
        expect(body).toEqual({
            windowing: {limit: 50, order: "descending"},
            include_archived: true,
            testset: {name: "abc"},
        })
    })

    it("Testset page query passes the cursor and returns the next cursor", async () => {
        queryTestsets.mockResolvedValueOnce({
            testsets: [{id: "t1", name: "One"}],
            count: 1,
            windowing: {next: "c2"},
        })
        const page = await queryTestsetsPage({projectId: "p1", limit: 1, cursor: "c1"})
        expect(queryTestsets.mock.calls[0][0].windowing).toEqual({
            limit: 1,
            order: "descending",
            next: "c1",
        })
        expect(queryTestsets.mock.calls[0][0].include_archived).toBe(false)
        expect(page.nextCursor).toBe("c2")
        expect(page.testsets.map((t) => t.id)).toEqual(["t1"])
    })

    it("Testset page query throws when the request fails", async () => {
        queryTestsets.mockRejectedValueOnce(new Error("boom"))
        await expect(queryTestsetsPage({projectId: "p1", limit: 10})).rejects.toThrow("boom")
    })
})

describe("fetchEvaluationRunIdsUsingTestsets", () => {
    it("In use check queries one evaluation run filter per testset and deduplicates run ids", async () => {
        queryRuns.mockImplementation(async (body: {run: {references: unknown[]}}) => {
            const ref = body.run.references[0] as {testset: {id: string}}
            return {runs: ref.testset.id === "t1" ? [{id: "r1"}, {id: "r2"}] : [{id: "r2"}]}
        })
        const ids = await fetchEvaluationRunIdsUsingTestsets({
            projectId: "p1",
            testsetIds: ["t1", "t2"],
        })
        expect(queryRuns).toHaveBeenCalledTimes(2)
        expect(queryRuns.mock.calls[0][0]).toEqual({
            run: {references: [{testset: {id: "t1"}}]},
        })
        expect(queryRuns.mock.calls[0][1]).toEqual({queryParams: {project_id: "p1"}})
        expect([...ids].sort()).toEqual(["r1", "r2"])
    })
})
