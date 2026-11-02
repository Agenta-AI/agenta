import {beforeEach, describe, expect, it, vi} from "vitest"

const post = vi.fn()

vi.mock("@agenta/shared/api", () => ({
    axios: {post: (...args: unknown[]) => post(...args), get: vi.fn(), put: vi.fn()},
    getAgentaApiUrl: () => "http://api.test",
}))

import {
    fetchTestsetsInUse,
    queryTestsetsPage,
    uploadTestsetFile,
    uploadTestsetRevisionFile,
} from "../../src/testset/api"

beforeEach(() => {
    post.mockReset()
})

const csvFile = () => new File(["a,b\n1,2"], "data.csv", {type: "text/csv"})

describe("uploadTestsetFile", () => {
    it("Upload as a new testset posts the file, the type and the name as multipart form data", async () => {
        post.mockResolvedValueOnce({data: {testset: {id: "t1", revision_id: "r1"}}})
        const file = csvFile()
        await uploadTestsetFile({projectId: "p1", file, fileType: "csv", testsetName: "My Testset"})

        const [url, body, config] = post.mock.calls[0]
        expect(url).toBe("http://api.test/simple/testsets/upload")
        expect(config.params).toEqual({project_id: "p1"})
        expect(config.headers["Content-Type"]).toBe("multipart/form-data")
        expect(body).toBeInstanceOf(FormData)
        expect(body.get("file")).toBeInstanceOf(File)
        expect(body.get("file_type")).toBe("csv")
        expect(body.get("testset_name")).toBe("My Testset")
    })

    it("Upload as a new testset returns the new revision id", async () => {
        post.mockResolvedValueOnce({data: {testset: {id: "t1", revision_id: "r1"}}})
        const result = await uploadTestsetFile({projectId: "p1", file: csvFile(), fileType: "csv"})
        expect(result).toEqual({testsetId: "t1", revisionId: "r1"})
        const body = post.mock.calls[0][1] as FormData
        expect(body.has("testset_name")).toBe(false)
    })
})

describe("uploadTestsetRevisionFile", () => {
    it("Upload as a new revision posts to the testset upload path", async () => {
        post.mockResolvedValueOnce({data: {testset: {id: "t1", revision_id: "r2"}}})
        const result = await uploadTestsetRevisionFile({
            projectId: "p1",
            testsetId: "t1",
            file: csvFile(),
            fileType: "json",
        })
        const [url, body, config] = post.mock.calls[0]
        expect(url).toBe("http://api.test/simple/testsets/t1/upload")
        expect(config.params).toEqual({project_id: "p1"})
        expect((body as FormData).get("file_type")).toBe("json")
        expect(result).toEqual({revisionId: "r2"})
    })
})

describe("queryTestsetsPage", () => {
    it("Testset page query sends the name filter in the body, not the URL", async () => {
        post.mockResolvedValueOnce({data: {testsets: [], count: 0}})
        await queryTestsetsPage({projectId: "p1", limit: 50, name: "abc", includeArchived: true})
        const [url, body, config] = post.mock.calls[0]
        expect(url).toBe("http://api.test/testsets/query")
        expect(url).not.toContain("abc")
        expect(config.params).toEqual({project_id: "p1"})
        expect(body).toEqual({
            windowing: {limit: 50, order: "descending"},
            include_archived: true,
            testset: {name: "abc"},
        })
    })

    it("Testset page query passes the cursor and returns the next cursor", async () => {
        post.mockResolvedValueOnce({
            data: {testsets: [{id: "t1", name: "One"}], count: 1, windowing: {next: "c2"}},
        })
        const page = await queryTestsetsPage({projectId: "p1", limit: 1, cursor: "c1"})
        expect(post.mock.calls[0][1].windowing).toEqual({
            limit: 1,
            order: "descending",
            next: "c1",
        })
        expect(post.mock.calls[0][1].include_archived).toBe(false)
        expect(page.nextCursor).toBe("c2")
        expect(page.testsets.map((t) => t.id)).toEqual(["t1"])
    })

    it("Testset page query throws when the request fails", async () => {
        post.mockRejectedValueOnce(new Error("boom"))
        await expect(queryTestsetsPage({projectId: "p1", limit: 10})).rejects.toThrow("boom")
    })
})

describe("fetchTestsetsInUse", () => {
    it("In use check queries one evaluation run filter per testset and deduplicates run ids", async () => {
        post.mockImplementation(async (_url: string, body: {run: {references: unknown[]}}) => {
            const ref = body.run.references[0] as {testset: {id: string}}
            return {
                data: {runs: ref.testset.id === "t1" ? [{id: "r1"}, {id: "r2"}] : [{id: "r2"}]},
            }
        })
        const ids = await fetchTestsetsInUse({projectId: "p1", testsetIds: ["t1", "t2"]})
        expect(post).toHaveBeenCalledTimes(2)
        expect(post.mock.calls[0][0]).toBe("http://api.test/evaluations/runs/query")
        expect(post.mock.calls[0][2].params).toEqual({project_id: "p1"})
        expect(post.mock.calls[0][1]).toEqual({run: {references: [{testset: {id: "t1"}}]}})
        expect([...ids].sort()).toEqual(["r1", "r2"])
    })
})
