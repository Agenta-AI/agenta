import {describe, expect, it, vi} from "vitest"

import {resolveStopExecution} from "../../../src/assets/resolveStopExecution"

const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
        resolve = done
    })
    return {promise, resolve}
}

describe("resolveStopExecution", () => {
    it("waits for the new execution instead of selecting an unnamed Stop", async () => {
        let executionId: string | undefined
        const tick = deferred()
        const resolving = resolveStopExecution({
            readExecutionId: () => executionId,
            isRunActive: () => true,
            wait: vi.fn(() => tick.promise),
        })

        executionId = "turn-resumed"
        tick.resolve()

        await expect(resolving).resolves.toEqual({
            status: "resolved",
            executionId: "turn-resumed",
        })
    })

    it("does not send a Stop after the run settles while its id is unresolved", async () => {
        let active = true
        const tick = deferred()
        const resolving = resolveStopExecution({
            readExecutionId: () => undefined,
            isRunActive: () => active,
            wait: () => tick.promise,
        })

        active = false
        tick.resolve()

        await expect(resolving).resolves.toEqual({status: "settled"})
    })

    it("can be abandoned when the owning mount leaves", async () => {
        const controller = new AbortController()
        const tick = deferred()
        const resolving = resolveStopExecution({
            readExecutionId: () => undefined,
            isRunActive: () => true,
            signal: controller.signal,
            wait: () => tick.promise,
        })

        controller.abort()
        tick.resolve()

        await expect(resolving).resolves.toEqual({status: "aborted"})
    })

    it("stops waiting at the deadline while the run remains active", async () => {
        let elapsed = 0
        const wait = vi.fn(async (ms: number) => {
            elapsed += ms
        })

        await expect(
            resolveStopExecution({
                readExecutionId: () => undefined,
                isRunActive: () => true,
                timeoutMs: 50,
                pollMs: 25,
                now: () => elapsed,
                wait,
            }),
        ).resolves.toEqual({status: "timed_out"})
        expect(wait).toHaveBeenCalledTimes(2)
    })
})
