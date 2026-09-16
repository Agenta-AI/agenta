import {describe, expect, it, vi} from "vitest"

import {continuationRetryAction} from "../../src/features/chat/continuationRetry"

const turn = (isLast: boolean, errorCode: string | null) =>
    ({isLast, status: {errorCode}}) as Parameters<typeof continuationRetryAction>[0]

describe("continuationRetryAction", () => {
    it("retries the latest continuation race error", () => {
        const retry = vi.fn()
        continuationRetryAction(turn(true, "continuation_resumed"), retry)?.()
        expect(retry).toHaveBeenCalledOnce()
    })

    it("does not offer retry on historical or unrelated failures", () => {
        const retry = vi.fn()
        expect(continuationRetryAction(turn(false, "continuation_resumed"), retry)).toBeUndefined()
        expect(continuationRetryAction(turn(true, "rate_limited"), retry)).toBeUndefined()
        expect(retry).not.toHaveBeenCalled()
    })
})
