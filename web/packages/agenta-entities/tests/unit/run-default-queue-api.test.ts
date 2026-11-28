import {beforeEach, describe, expect, it, vi} from "vitest"

const {getMock} = vi.hoisted(() => ({getMock: vi.fn()}))

vi.mock("@agenta/shared/api", () => ({
    axios: {get: getMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {fetchRunDefaultQueue} from "../../src/simpleQueue/api"

beforeEach(() => {
    getMock.mockReset()
})

describe("fetchRunDefaultQueue", () => {
    it("reads the run's default queue and returns its id", async () => {
        getMock.mockResolvedValue({
            data: {
                count: 1,
                queue: {id: "queue-1", run_id: "run-1", flags: {is_sequential: false}},
            },
        })
        await expect(fetchRunDefaultQueue("p1", "run-1")).resolves.toBe("queue-1")
        expect(getMock).toHaveBeenCalledWith(
            "https://agenta.test/api/evaluations/runs/run-1/queues/default",
            {params: {project_id: "p1"}},
        )
    })

    it("returns null for a run with no active default queue", async () => {
        getMock.mockResolvedValue({data: {count: 0}})
        await expect(fetchRunDefaultQueue("p1", "run-1")).resolves.toBeNull()
    })

    it("sends nothing without a project or a run", async () => {
        await expect(fetchRunDefaultQueue("", "run-1")).resolves.toBeNull()
        await expect(fetchRunDefaultQueue("p1", "")).resolves.toBeNull()
        expect(getMock).not.toHaveBeenCalled()
    })
})
