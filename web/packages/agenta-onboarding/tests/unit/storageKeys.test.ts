/**
 * R3 regression — localStorage key format must stay byte-identical across the move so existing
 * users keep their seen-tours / widget state. The keys are copied verbatim from the pre-move
 * app code; this asserts the persisted key strings explicitly.
 */
import {createStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {onboardingStorageUserIdAtom, recordWidgetEventAtom, markTourSeenAtom} from "../../src/state"

const USER = "user-1"

function makeLocalStorageMock() {
    const m = new Map<string, string>()
    return {
        store: m,
        getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
        setItem: (k: string, v: string) => {
            m.set(k, v)
        },
        removeItem: (k: string) => {
            m.delete(k)
        },
        clear: () => m.clear(),
        key: (i: number) => Array.from(m.keys())[i] ?? null,
        get length() {
            return m.size
        },
    }
}

let ls: ReturnType<typeof makeLocalStorageMock>

beforeEach(() => {
    ls = makeLocalStorageMock()
    vi.stubGlobal("localStorage", ls)
    vi.stubGlobal("window", {localStorage: ls})
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("R3: persisted storage keys", () => {
    it("scopes widget events under agenta:onboarding:{userId}:widget-events", () => {
        const store = createStore()
        store.set(onboardingStorageUserIdAtom, USER)
        store.set(recordWidgetEventAtom, "playground_ran_prompt")

        expect(ls.store.has(`agenta:onboarding:${USER}:widget-events`)).toBe(true)
    })

    it("scopes seen tours under agenta:onboarding:{userId}:seen-tours", () => {
        const store = createStore()
        store.set(onboardingStorageUserIdAtom, USER)
        store.set(markTourSeenAtom, "tour-1")

        expect(ls.store.has(`agenta:onboarding:${USER}:seen-tours`)).toBe(true)
    })

    it("persists the active user id under agenta:onboarding:active-user-id", () => {
        const store = createStore()
        store.set(onboardingStorageUserIdAtom, USER)

        expect(ls.store.has("agenta:onboarding:active-user-id")).toBe(true)
    })
})
