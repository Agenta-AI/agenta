import {describe, expect, it, vi} from "vitest"

import {runRetryAction} from "../../src/features/chat/runRetry"

const turn = (isLast: boolean) => ({isLast, status: {}}) as Parameters<typeof runRetryAction>[0]

describe("runRetryAction", () => {
    it("offers the retry on the turn that can replay its own message", () => {
        const retry = vi.fn()
        runRetryAction(turn(true), retry)?.()
        expect(retry).toHaveBeenCalledOnce()
    })

    it("offers nothing on a historical turn, which would replay the wrong message", () => {
        const retry = vi.fn()
        expect(runRetryAction(turn(false), retry)).toBeUndefined()
        expect(retry).not.toHaveBeenCalled()
    })
})
