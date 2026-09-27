import {atom, createStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {BUILD_KIT_WAIT_LIMIT_MS, waitForBuildKit} from "../../src/features/chat/buildKitWait"

// A new agent's first turn must carry the build kit; sent without it, the next turn's full config
// evicts the warm sandbox.
describe("waitForBuildKit", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it("resolves at once when the overlay has settled", async () => {
        const store = createStore()
        await expect(waitForBuildKit(store, atom(true))).resolves.toBe(true)
    })

    it("waits for the overlay to settle", async () => {
        const store = createStore()
        const ready = atom(false)
        const wait = waitForBuildKit(store, ready)
        await vi.advanceTimersByTimeAsync(BUILD_KIT_WAIT_LIMIT_MS - 1)
        store.set(ready, true)
        await expect(wait).resolves.toBe(true)
    })

    it("gives up after the limit so the message is sent without the kit", async () => {
        const store = createStore()
        const wait = waitForBuildKit(store, atom(false))
        await vi.advanceTimersByTimeAsync(BUILD_KIT_WAIT_LIMIT_MS)
        await expect(wait).resolves.toBe(false)
    })
})
