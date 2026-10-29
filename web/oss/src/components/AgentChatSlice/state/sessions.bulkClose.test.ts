/**
 * "Close other tabs" / "Close tabs to the right" (#6295).
 *
 * One write for the whole set, with the same rules as closing a single tab: the sessions stay in
 * history so they can be reopened, and the active tab lands on the nearest survivor.
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {projectIdAtom} from "@/oss/state/project"

const {
    addSessionAtomFamily,
    closeSessionsAtomFamily,
    setActiveSessionAtomFamily,
    activeSessionIdAtomFamily,
    sessionsListAtomFamily,
    sessionHistoryAtomFamily,
    renameSessionAtomFamily,
} = await import("./sessions")

const SCOPE = "app-bulk-close"

/** Named sessions are not husks, so closing keeps them in history. */
const newStore = (ids = ["a", "b", "c", "d"]) => {
    const store = createStore()
    store.set(projectIdAtom, "project-1")
    ids.forEach((id) => {
        store.set(addSessionAtomFamily(SCOPE), {id})
        store.set(renameSessionAtomFamily(SCOPE), {id, title: `session ${id}`})
    })
    return store
}

const tabIds = (store: ReturnType<typeof createStore>) =>
    store.get(sessionsListAtomFamily(SCOPE)).map((s) => s.id)
const activeId = (store: ReturnType<typeof createStore>) =>
    store.get(activeSessionIdAtomFamily(SCOPE))

describe("closeSessionsAtomFamily", () => {
    it("closes every id it is given in one write", () => {
        const store = newStore()
        store.set(closeSessionsAtomFamily(SCOPE), ["a", "c", "d"])
        expect(tabIds(store)).toEqual(["b"])
    })

    it("keeps the closed sessions reopenable from history", () => {
        const store = newStore()
        store.set(closeSessionsAtomFamily(SCOPE), ["a", "c"])
        expect(
            store
                .get(sessionHistoryAtomFamily(SCOPE))
                .map((s) => s.id)
                .sort(),
        ).toEqual(["a", "b", "c", "d"])
    })

    it("leaves the active tab alone when it survives", () => {
        const store = newStore()
        store.set(setActiveSessionAtomFamily(SCOPE), "b")
        store.set(closeSessionsAtomFamily(SCOPE), ["a", "c"])
        expect(activeId(store)).toBe("b")
    })

    it("moves the active tab to the one that takes its slot", () => {
        const store = newStore()
        store.set(setActiveSessionAtomFamily(SCOPE), "b")
        store.set(closeSessionsAtomFamily(SCOPE), ["b", "c"])
        expect(activeId(store)).toBe("d")
    })

    it("falls back to the left when nothing survives to the right", () => {
        const store = newStore()
        store.set(setActiveSessionAtomFamily(SCOPE), "c")
        store.set(closeSessionsAtomFamily(SCOPE), ["c", "d"])
        expect(activeId(store)).toBe("b")
    })

    it("ignores an empty set and ids that are not open", () => {
        const store = newStore()
        store.set(setActiveSessionAtomFamily(SCOPE), "b")
        store.set(closeSessionsAtomFamily(SCOPE), [])
        store.set(closeSessionsAtomFamily(SCOPE), ["not-a-tab"])
        expect(tabIds(store)).toEqual(["a", "b", "c", "d"])
        expect(activeId(store)).toBe("b")
    })

    it("discards never-run husks instead of leaving them in history", () => {
        const store = newStore(["a"])
        store.set(addSessionAtomFamily(SCOPE), {id: "blank"})
        store.set(closeSessionsAtomFamily(SCOPE), ["blank"])
        expect(tabIds(store)).toEqual(["a"])
        expect(store.get(sessionHistoryAtomFamily(SCOPE)).map((s) => s.id)).toEqual(["a"])
    })
})
