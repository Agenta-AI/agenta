import {beforeEach, describe, expect, it, vi} from "vitest"

const post = vi.fn()

vi.mock("@agenta/shared/api", () => ({
    axios: {post: (...args: unknown[]) => post(...args)},
    getAgentaApiUrl: () => "http://api",
}))

import {fetchLatestRevisionsBatch} from "../../src/testset/api"

const revision = (id: string, testsetId: string, version: string, message: string) => ({
    id,
    testset_id: testsetId,
    version,
    message,
})

beforeEach(() => post.mockReset())

describe("fetchLatestRevisionsBatch", () => {
    it("keeps the highest version per test set when the API returns every revision unordered", async () => {
        post.mockResolvedValueOnce({
            data: {
                count: 4,
                testset_revisions: [
                    revision("t1-v2", "t1", "2", "second"),
                    revision("t1-v1", "t1", "1", "first"),
                    revision("t2-v1", "t2", "1", "only"),
                    revision("t1-v0", "t1", "0", ""),
                ],
            },
        })

        const result = await fetchLatestRevisionsBatch("p1", ["t1", "t2"])

        expect(result.get("t1")?.id).toBe("t1-v2")
        expect(result.get("t1")?.message).toBe("second")
        expect(result.get("t2")?.id).toBe("t2-v1")
    })
})
