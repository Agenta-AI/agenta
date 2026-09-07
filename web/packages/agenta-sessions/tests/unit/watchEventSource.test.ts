import {describe, expect, it} from "vitest"

import {shouldCoalesceWatchEvent} from "../../src/watch/watchEventSource"

describe("watch event coalescing", () => {
    it("does not delay interaction resolution behind the shared refetch window", () => {
        expect(shouldCoalesceWatchEvent("interaction")).toBe(false)
        expect(shouldCoalesceWatchEvent("record")).toBe(true)
    })
})
