import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    activeSessionTitleAtomFamily,
    adoptSessionAtomFamily,
    reconcileServerSessionsAtomFamily,
    renameSessionAtomFamily,
    sessionHistoryAtomFamily,
    setActiveSessionAtomFamily,
} from "./sessions"

describe("activeSessionTitleAtomFamily", () => {
    it("reacts to active-session switches and renames", () => {
        const scope = `page-title-${Date.now()}`
        const store = createStore()

        store.set(adoptSessionAtomFamily(scope), {id: "one", title: "First"})
        store.set(adoptSessionAtomFamily(scope), {id: "two", title: "Second"})

        expect(store.get(activeSessionTitleAtomFamily(scope)).title).toBe("Second")

        store.set(setActiveSessionAtomFamily(scope), "one")
        expect(store.get(activeSessionTitleAtomFamily(scope)).title).toBe("First")

        store.set(renameSessionAtomFamily(scope), {id: "one", title: "Renamed"})
        expect(store.get(activeSessionTitleAtomFamily(scope)).title).toBe("Renamed")
    })
})

describe("reconcileServerSessionsAtomFamily title precedence", () => {
    const titleOf = (store: ReturnType<typeof createStore>, scope: string, id: string) =>
        store.get(sessionHistoryAtomFamily(scope)).find((s) => s.id === id)?.title

    it("lets a non-empty server name replace a local one", () => {
        const scope = `reconcile-server-wins-${Date.now()}`
        const store = createStore()

        store.set(adoptSessionAtomFamily(scope), {id: "one", title: "Local title"})
        store.set(reconcileServerSessionsAtomFamily(scope), [
            {id: "one", title: "Agent-chosen title"},
        ])

        expect(titleOf(store, scope, "one")).toBe("Agent-chosen title")
    })

    it("keeps the local name when the server one is empty or blank", () => {
        const scope = `reconcile-local-kept-${Date.now()}`
        const store = createStore()

        store.set(adoptSessionAtomFamily(scope), {id: "one", title: "Local title"})
        store.set(reconcileServerSessionsAtomFamily(scope), [{id: "one", title: "   "}])
        expect(titleOf(store, scope, "one")).toBe("Local title")

        store.set(reconcileServerSessionsAtomFamily(scope), [{id: "one"}])
        expect(titleOf(store, scope, "one")).toBe("Local title")
    })

    it("adopts the server name for a session absent locally", () => {
        const scope = `reconcile-adopt-${Date.now()}`
        const store = createStore()

        store.set(reconcileServerSessionsAtomFamily(scope), [
            {id: "new-one", title: "Server-only title"},
        ])

        expect(titleOf(store, scope, "new-one")).toBe("Server-only title")
    })
})
