/**
 * Pins the ordering guarantee behind the interaction-lifecycle fix: the durable row is recorded
 * BEFORE anything that can start a turn, because a new turn's stale sweep cancels every row still
 * `pending` — including the one being answered. Review round 1 caught this racing instead of
 * ordering; live QA later caught the approval half racing the same way.
 */
import {describe, expect, it, vi} from "vitest"

import {
    RECORD_ANSWER_TIMEOUT_MS,
    recordAnswerThenRelease,
} from "../../src/state/execution/answerOrdering"

const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((r) => {
        resolve = r
    })
    return {promise, resolve}
}

describe("recordAnswerThenRelease", () => {
    it("does not release until the record settles", async () => {
        const gate = deferred()
        const order: string[] = []
        const release = vi.fn(() => order.push("release"))

        const done = recordAnswerThenRelease({
            record: async () => {
                await gate.promise
                order.push("record")
            },
            release,
        })

        await Promise.resolve()
        expect(release).not.toHaveBeenCalled()

        gate.resolve()
        await done
        expect(order).toEqual(["record", "release"])
    })

    it("releases once the record fails", async () => {
        const release = vi.fn()
        await recordAnswerThenRelease({
            record: async () => {
                throw new Error("interactions API is down")
            },
            release,
        })
        expect(release).toHaveBeenCalledTimes(1)
    })

    it("releases when the record never settles, so a wedged API cannot block it", async () => {
        vi.useFakeTimers()
        try {
            const release = vi.fn()
            const done = recordAnswerThenRelease({
                record: () => new Promise<void>(() => undefined),
                release,
                timeoutMs: 50,
            })
            await vi.advanceTimersByTimeAsync(49)
            expect(release).not.toHaveBeenCalled()
            await vi.advanceTimersByTimeAsync(1)
            await done
            expect(release).toHaveBeenCalledTimes(1)
        } finally {
            vi.useRealTimers()
        }
    })

    it("keeps the cap short enough to cost one beat, not the turn", () => {
        expect(RECORD_ANSWER_TIMEOUT_MS).toBeLessThanOrEqual(2_000)
    })

    it("holds an approval's part flip behind its row transition", async () => {
        // The approval case, in the shape the hooks use it. The flip is what lets the SDK dispatch
        // its resume, so releasing it early is what let cancel-stale reach the API first and cancel
        // the row being answered (measured: sweep at .491, the transition 404 at .636).
        const seen: string[] = []
        const transition = deferred()

        const done = recordAnswerThenRelease({
            record: async () => {
                await transition.promise
                seen.push("row responded")
            },
            release: () => seen.push("part flipped"),
        })

        await Promise.resolve()
        expect(seen).toEqual([])

        transition.resolve()
        await done
        expect(seen).toEqual(["row responded", "part flipped"])
    })
})
