/**
 * A page with its own filter set (the Sessions page locked to one agent) must never change the
 * filters the all-sessions pages share.
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    createSessionFilterAtoms,
    resetSessionFiltersAtom,
    sessionAgentFilterAtom,
    sessionSearchAtom,
    sessionStatusFilterAtom,
    sharedSessionFilterAtoms,
} from "../../src/state/filters"

describe("session filter atom sets", () => {
    it("exports the shared set under the existing names", () => {
        expect(sessionSearchAtom).toBe(sharedSessionFilterAtoms.search)
        expect(sessionAgentFilterAtom).toBe(sharedSessionFilterAtoms.agent)
        expect(resetSessionFiltersAtom).toBe(sharedSessionFilterAtoms.reset)
    })

    it("keeps a page's own set apart from the shared set", () => {
        const store = createStore()
        store.set(sessionSearchAtom, "refund")
        store.set(sessionStatusFilterAtom, "waiting")

        const own = createSessionFilterAtoms()
        store.set(own.search, "login")
        store.set(own.status, "running")
        store.set(own.showTriggered, true)
        store.set(own.reset)
        store.set(own.archivedOnly, true)

        expect(store.get(sessionSearchAtom)).toBe("refund")
        expect(store.get(sessionStatusFilterAtom)).toBe("waiting")
        expect(store.get(sharedSessionFilterAtoms.archivedOnly)).toBe(false)
        expect(store.get(own.search)).toBe("")
        expect(store.get(own.archivedOnly)).toBe(true)
        expect(store.get(own.activeExceptAgent)).toBe(true)
    })
})
