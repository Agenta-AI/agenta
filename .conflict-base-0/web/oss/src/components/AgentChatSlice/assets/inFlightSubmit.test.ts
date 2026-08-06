import {describe, expect, it, vi} from "vitest"

import {runWithInFlightSubmit} from "./inFlightSubmit"

describe("in-flight submit guard", () => {
    it("drops a second submit while the first await is unresolved", async () => {
        let release!: () => void
        const pending = new Promise<void>((resolve) => {
            release = resolve
        })
        const task = vi.fn(() => pending)
        const inFlight = {current: false}

        const first = runWithInFlightSubmit(inFlight, task)
        const second = runWithInFlightSubmit(inFlight, task)

        await expect(second).resolves.toBeUndefined()
        expect(task).toHaveBeenCalledTimes(1)

        release()
        await first
        await runWithInFlightSubmit(inFlight, task)
        expect(task).toHaveBeenCalledTimes(2)
    })
})
