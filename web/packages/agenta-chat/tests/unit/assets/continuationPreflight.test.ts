import {describe, expect, it, vi} from "vitest"

import {
    assertNoResumedSessionContinuation,
    prepareAfterContinuationPreflight,
} from "../../../src/assets/continuationPreflight"
import {parseAgentRunError} from "../../../src/model/error"

describe("assertNoResumedSessionContinuation", () => {
    it("allows the ordinary request when the API did not resume a continuation", async () => {
        await expect(
            assertNoResumedSessionContinuation(vi.fn().mockResolvedValue(false), "session-1"),
        ).resolves.toBeUndefined()
    })

    it("throws the retryable typed error when the saved continuation owns the turn", async () => {
        let error: unknown
        try {
            await assertNoResumedSessionContinuation(vi.fn().mockResolvedValue(true), "session-1")
        } catch (caught) {
            error = caught
        }

        expect(parseAgentRunError(error)).toEqual({
            code: "continuation_resumed",
            message:
                "A saved approval is resuming. Wait for it to finish, then try this message again.",
        })
    })

    it("never builds a request when the continuation takes ownership", async () => {
        const prepare = vi.fn().mockResolvedValue({body: "must not run"})

        await expect(
            prepareAfterContinuationPreflight(
                vi.fn().mockResolvedValue(true),
                "session-1",
                prepare,
            ),
        ).rejects.toThrow("continuation_resumed")
        expect(prepare).not.toHaveBeenCalled()
    })

    it("still builds a request when the additive preflight transport fails", async () => {
        const prepare = vi.fn().mockResolvedValue({body: "ordinary send"})

        await expect(
            prepareAfterContinuationPreflight(
                vi.fn().mockRejectedValue(new Error("older API")),
                "session-1",
                prepare,
            ),
        ).resolves.toEqual({body: "ordinary send"})
        expect(prepare).toHaveBeenCalledOnce()
    })
})
