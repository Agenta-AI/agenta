import {afterEach, describe, expect, it, vi} from "vitest"

import {claimOnceHint, isOnceHintDue, markOnceHintShown} from "../../src/utils/onceHint"

const stubWindowWithStorage = () => {
    const store = new Map<string, string>()
    vi.stubGlobal("window", {
        localStorage: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, value),
            removeItem: (key: string) => void store.delete(key),
        },
    })
    return store
}

afterEach(() => {
    vi.unstubAllGlobals()
})

/** The ask-agent hint scenarios: once per action key, and silent where hints cannot show. */
describe("onceHint", () => {
    it("claims exactly once per key", () => {
        stubWindowWithStorage()
        expect(claimOnceHint("automation-created-manually")).toBe(true)
        expect(claimOnceHint("automation-created-manually")).toBe(false)
        expect(claimOnceHint("automation-created-manually")).toBe(false)
    })

    it("keys are independent: one hint shown does not consume another", () => {
        stubWindowWithStorage()
        expect(claimOnceHint("automation-created-manually")).toBe(true)
        expect(claimOnceHint("some-other-action")).toBe(true)
    })

    it("isOnceHintDue reports without consuming", () => {
        stubWindowWithStorage()
        expect(isOnceHintDue("k")).toBe(true)
        expect(isOnceHintDue("k")).toBe(true)
        markOnceHintShown("k")
        expect(isOnceHintDue("k")).toBe(false)
    })

    it("never claims without a window (SSR, tests): the hint just does not fire", () => {
        // No stub: plain node environment.
        expect(isOnceHintDue("k")).toBe(false)
        expect(claimOnceHint("k")).toBe(false)
    })
})
