/**
 * Pinned sessions lead the playground tab strip.
 *
 * The pin is the project-wide one the rail and the sessions page share, so pinning a tab has to
 * move it to the front of the strip too — and unpinning has to drop it back into tab order.
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {projectIdAtom} from "@/oss/state/project"

const {toggleSessionPinAtom} = await import("@agenta/sessions/state")
const {addSessionAtomFamily, reorderSessionsAtomFamily, sessionsListAtomFamily} =
    await import("./sessions")

const SCOPE = "app-pinned-tabs"

const tabIds = (store: ReturnType<typeof createStore>) =>
    store.get(sessionsListAtomFamily(SCOPE)).map((s) => s.id)

const newStore = () => {
    const store = createStore()
    store.set(projectIdAtom, "project-1")
    ;["a", "b", "c"].forEach((id) => store.set(addSessionAtomFamily(SCOPE), {id}))
    return store
}

describe("sessionsListAtomFamily pin ordering", () => {
    it("keeps tab order when nothing is pinned", () => {
        expect(tabIds(newStore())).toEqual(["a", "b", "c"])
    })

    it("moves a pinned tab to the front, keeping the rest in tab order", () => {
        const store = newStore()
        store.set(toggleSessionPinAtom, "c")
        expect(tabIds(store)).toEqual(["c", "a", "b"])
    })

    it("keeps tab order among the pins and among the rest", () => {
        const store = newStore()
        store.set(toggleSessionPinAtom, "c")
        store.set(toggleSessionPinAtom, "b")
        expect(tabIds(store)).toEqual(["b", "c", "a"])
    })

    it("drops a tab back into tab order when unpinned", () => {
        const store = newStore()
        store.set(toggleSessionPinAtom, "c")
        store.set(toggleSessionPinAtom, "c")
        expect(tabIds(store)).toEqual(["a", "b", "c"])
    })

    it("re-sorts a drag that lands an unpinned tab among the pins", () => {
        const store = newStore()
        store.set(toggleSessionPinAtom, "c")
        store.set(reorderSessionsAtomFamily(SCOPE), ["a", "c", "b"])
        expect(tabIds(store)).toEqual(["c", "a", "b"])
    })
})
