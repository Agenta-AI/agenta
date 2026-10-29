import {describe, expect, it, vi} from "vitest"

const fernQuerySessionStreams = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getSessionsClient: vi.fn(),
    getLowPrioritySessionsClient: () => ({querySessionStreams: fernQuerySessionStreams}),
    getMountsClient: vi.fn(),
    getLowPriorityMountsClient: vi.fn(),
}))

import {readAliveStreams} from "../../src/session/api/api"
import {livenessRefetchInterval} from "../../src/session/core/liveness"

describe("the liveness poll's read", () => {
    it("throws on a failed read, so the poll keeps the last answer and retries", async () => {
        fernQuerySessionStreams.mockReturnValue({
            withRawResponse: () => Promise.reject({statusCode: 503}),
        })
        await expect(readAliveStreams("project-1")).rejects.toThrow(/unavailable/)
    })

    it("polls every 5 s after a failed read, and by the flags otherwise", () => {
        expect(livenessRefetchInterval({state: {status: "error"}})).toBe(5_000)
        expect(
            livenessRefetchInterval({
                state: {
                    status: "success",
                    data: [{flags: {is_alive: true, is_running: true}} as never],
                },
            }),
        ).toBe(15_000)
        expect(livenessRefetchInterval({state: {status: "success", data: []}})).toBe(false)
    })
})
