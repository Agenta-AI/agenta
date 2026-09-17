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

    it("does not narrow by failure class, which the callout decides for both apps", () => {
        // It used to answer only for `continuation_resumed`, so a rate limit or a lost execution
        // drew no button here and did on the desktop.
        const retry = vi.fn()
        expect(runRetryAction(turn(true), retry)).toBeDefined()
    })
})
