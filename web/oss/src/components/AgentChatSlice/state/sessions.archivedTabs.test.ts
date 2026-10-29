/**
 * Opening an archived session (#6468).
 *
 * Archiving closes the tab at the write site — locally, and on the next reconcile when it happened
 * on another device. The tab list itself must therefore NOT re-filter archived sessions, or a
 * session the user deliberately opened from the sessions page is adopted and then dropped before
 * it can render.
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {projectIdAtom} from "@/oss/state/project"

const {
    adoptSessionAtomFamily,
    addSessionAtomFamily,
    archiveSessionAtomFamily,
    reconcileServerSessionsAtomFamily,
    sessionsListAtomFamily,
    activeSessionIdAtomFamily,
    unarchiveSessionAtomFamily,
} = await import("./sessions")

const SCOPE = "app-archived-tabs"

const newStore = () => {
    const store = createStore()
    store.set(projectIdAtom, "project-1")
    return store
}

const tabIds = (store: ReturnType<typeof createStore>) =>
    store.get(sessionsListAtomFamily(SCOPE)).map((s) => s.id)

/** The archived row as the sessions page's server list reports it. */
const archivedOnServer = (id: string) => ({
    id,
    title: `session ${id}`,
    lastMessageAt: 1,
    archived: true,
})

describe("an archived session opened on purpose", () => {
    it("becomes a tab, and stays one as the server confirms it is archived", () => {
        const store = newStore()
        // What "open in playground" does once the panel mounts: adopt by id, sight unseen.
        store.set(adoptSessionAtomFamily(SCOPE), {id: "old", title: "session old"})
        expect(tabIds(store)).toEqual(["old"])
        expect(store.get(activeSessionIdAtomFamily(SCOPE))).toBe("old")

        store.set(reconcileServerSessionsAtomFamily(SCOPE), [archivedOnServer("old")])
        expect(tabIds(store)).toEqual(["old"])
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [
            {...archivedOnServer("old"), lastMessageAt: 2},
        ])
        expect(tabIds(store)).toEqual(["old"])
    })

    it("stays a tab when it was already known to be archived", () => {
        const store = newStore()
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [archivedOnServer("old")])
        expect(tabIds(store)).toEqual([])

        store.set(adoptSessionAtomFamily(SCOPE), {id: "old"})
        expect(tabIds(store)).toEqual(["old"])
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [
            {...archivedOnServer("old"), lastMessageAt: 2},
        ])
        expect(tabIds(store)).toEqual(["old"])
    })
})

describe("archiving still closes the tab", () => {
    it("closes it when archived here", () => {
        const store = newStore()
        store.set(addSessionAtomFamily(SCOPE), {id: "mine"})
        store.set(addSessionAtomFamily(SCOPE), {id: "other"})
        store.set(archiveSessionAtomFamily(SCOPE), "mine")
        expect(tabIds(store)).toEqual(["other"])
    })

    it("closes it when archived on another device, and re-points the active tab", () => {
        const store = newStore()
        store.set(addSessionAtomFamily(SCOPE), {id: "mine"})
        store.set(addSessionAtomFamily(SCOPE), {id: "other"})
        // The server has to have answered first: that is what makes a later `archived: true` a
        // change of the server's mind rather than the first thing we ever learned about it.
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [
            {id: "mine", lastMessageAt: 1},
            {id: "other", lastMessageAt: 1},
        ])
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [
            {id: "mine", lastMessageAt: 2, archived: true},
            {id: "other", lastMessageAt: 1},
        ])
        expect(tabIds(store)).toEqual(["other"])
        expect(store.get(activeSessionIdAtomFamily(SCOPE))).toBe("other")
    })

    /**
     * The reconcile query (`internal-reconciliation`) is not among the keys the session verbs
     * invalidate, so an unarchive never supersedes a poll already in flight. That poll answers
     * with the pre-unarchive row, and a guard reading the LOCAL flag would read the disagreement
     * as a remote archive and close the tab the user just restored.
     */
    it("keeps the tab when a stale poll contradicts a local unarchive", () => {
        const store = newStore()
        store.set(adoptSessionAtomFamily(SCOPE), {id: "old"})
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [archivedOnServer("old")])
        expect(tabIds(store)).toEqual(["old"])

        store.set(unarchiveSessionAtomFamily(SCOPE), "old")
        // In flight before the unarchive landed, so it still reports the session as archived.
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [
            {...archivedOnServer("old"), lastMessageAt: 2},
        ])
        expect(tabIds(store)).toEqual(["old"])
    })
})
