/**
 * Pins the ordering guarantee behind the interaction-lifecycle fix: the durable row is recorded
 * BEFORE the resume is dispatched, because the resume starts a turn whose stale sweep cancels
 * every still-`pending` row. Review round 1 caught this racing instead of ordering.
 */
import {describe, expect, it, vi} from "vitest"

import {RECORD_ANSWER_TIMEOUT_MS, recordAnswerThenResume} from "./clientToolAnswer"

const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((r) => {
        resolve = r
    })
    return {promise, resolve}
}

describe("recordAnswerThenResume", () => {
    it("does not dispatch the resume until the record settles", async () => {
        const gate = deferred()
        const order: string[] = []
        const resume = vi.fn(() => order.push("resume"))

        const done = recordAnswerThenResume({
            record: async () => {
                await gate.promise
                order.push("record")
            },
            resume,
        })

        await Promise.resolve()
        expect(resume).not.toHaveBeenCalled()

        gate.resolve()
        await done
        expect(order).toEqual(["record", "resume"])
    })

    it("dispatches the resume once the record fails", async () => {
        const resume = vi.fn()
        await recordAnswerThenResume({
            record: async () => {
                throw new Error("interactions API is down")
            },
            resume,
        })
        expect(resume).toHaveBeenCalledTimes(1)
    })

    it("dispatches the resume when the record never settles, so a wedged API cannot block it", async () => {
        vi.useFakeTimers()
        try {
            const resume = vi.fn()
            const done = recordAnswerThenResume({
                record: () => new Promise<void>(() => undefined),
                resume,
                timeoutMs: 50,
            })
            await vi.advanceTimersByTimeAsync(49)
            expect(resume).not.toHaveBeenCalled()
            await vi.advanceTimersByTimeAsync(1)
            await done
            expect(resume).toHaveBeenCalledTimes(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it("keeps the cap short enough to cost one beat, not the turn", () => {
        expect(RECORD_ANSWER_TIMEOUT_MS).toBeLessThanOrEqual(2_000)
    })
})
