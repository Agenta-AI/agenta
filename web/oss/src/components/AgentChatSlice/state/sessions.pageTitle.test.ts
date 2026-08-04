import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    activeSessionTitleAtomFamily,
    adoptSessionAtomFamily,
    renameSessionAtomFamily,
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
