import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    applySessionScopeAtom,
    resetSessionFiltersAtom,
    sessionFiltersActiveAtom,
    sessionShowAgentCreatedAtom,
    sessionShowTriggeredAtom,
} from "../../src/state/filters"

describe("agent-created session visibility", () => {
    it("starts hidden and marks the filter active when revealed", () => {
        const store = createStore()
        expect(store.get(sessionShowAgentCreatedAtom)).toBe(false)
        store.set(sessionShowAgentCreatedAtom, true)
        expect(store.get(sessionFiltersActiveAtom)).toBe(true)
    })

    it("reset hides agent-created sessions again", () => {
        const store = createStore()
        store.set(sessionShowAgentCreatedAtom, true)
        store.set(resetSessionFiltersAtom)
        expect(store.get(sessionShowAgentCreatedAtom)).toBe(false)
        expect(store.get(sessionFiltersActiveAtom)).toBe(false)
    })

    it("changing scope does not leak the previous visibility choice", () => {
        const store = createStore()
        store.set(sessionShowAgentCreatedAtom, true)
        store.set(applySessionScopeAtom, {origin: "trigger"})
        expect(store.get(sessionShowAgentCreatedAtom)).toBe(false)
        expect(store.get(sessionShowTriggeredAtom)).toBe(true)
    })
})
