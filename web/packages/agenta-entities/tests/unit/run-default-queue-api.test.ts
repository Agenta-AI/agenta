import {beforeEach, describe, expect, it, vi} from "vitest"

const {fetchDefaultQueue} = vi.hoisted(() => ({fetchDefaultQueue: vi.fn()}))

vi.mock("@agenta/sdk/resources", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/sdk/resources")>()),
    getEvaluationsClient: () => ({fetchDefaultQueue}),
}))

import {fetchRunDefaultQueue} from "../../src/simpleQueue/api"

beforeEach(() => {
    fetchDefaultQueue.mockReset()
})

describe("fetchRunDefaultQueue", () => {
    it("reads the run's default queue and returns its id", async () => {
        fetchDefaultQueue.mockResolvedValue({
            count: 1,
            queue: {id: "queue-1", run_id: "run-1", flags: {is_sequential: false}},
        })
        await expect(fetchRunDefaultQueue("p1", "run-1")).resolves.toBe("queue-1")
        expect(fetchDefaultQueue).toHaveBeenCalledWith(
            {run_id: "run-1"},
            {queryParams: {project_id: "p1"}},
        )
    })

    it("returns null for a run with no active default queue", async () => {
        fetchDefaultQueue.mockResolvedValue({count: 0})
        await expect(fetchRunDefaultQueue("p1", "run-1")).resolves.toBeNull()
    })

    it("sends nothing without a project or a run", async () => {
        await expect(fetchRunDefaultQueue("", "run-1")).resolves.toBeNull()
        await expect(fetchRunDefaultQueue("p1", "")).resolves.toBeNull()
        expect(fetchDefaultQueue).not.toHaveBeenCalled()
    })
})
