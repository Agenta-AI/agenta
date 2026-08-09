/**
 * Delete durability for the session rail (#5543).
 *
 * The bug these pin: `serverKnown` only flips on a successful reconcile, but the durable row
 * exists from the first message on. A session deleted inside that window deleted LOCALLY only,
 * and the next reconcile re-adopted the still-listed row as a brand-new server session — the
 * delete visibly undid itself.
 *
 * Everything here is the real store, the real atoms and the real reconciler; only the network
 * boundary (`@agenta/entities/session`) is stubbed, so the assertions are about what the state
 * layer decides to send and to adopt.
 */
import {createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

import {projectIdAtom} from "@/oss/state/project"

interface DeleteSessionRemoteArgs {
    sessionId: string
    projectId: string
    appId?: string
    abortSignal?: AbortSignal
}

const deleteSessionRemote = vi.fn(async (_args: DeleteSessionRemoteArgs) => true)

vi.mock("@agenta/entities/session", () => ({
    deleteSessionRemote: (args: DeleteSessionRemoteArgs) => deleteSessionRemote(args),
    archiveSessionRemote: vi.fn(async () => true),
    unarchiveSessionRemote: vi.fn(async () => true),
    setSessionHeader: vi.fn(),
}))

const {
    adoptSessionAtomFamily,
    deleteSessionAtomFamily,
    reconcileServerSessionsAtomFamily,
    sessionHistoryAtomFamily,
} = await import("./sessions")

/** A young session as the rail holds it before any reconcile: no `serverKnown`. */
const newStoreWithSession = (scope: string, id: string) => {
    const store = createStore()
    store.set(projectIdAtom, "project-1")
    store.set(adoptSessionAtomFamily(scope), {id})
    return store
}

const historyIds = (store: ReturnType<typeof createStore>, scope: string) =>
    store.get(sessionHistoryAtomFamily(scope)).map((s) => s.id)

beforeEach(() => {
    deleteSessionRemote.mockClear()
})

describe("deleteSessionAtomFamily", () => {
    it("deletes remotely even before the session is server-known", () => {
        const scope = "delete-young"
        const store = newStoreWithSession(scope, "young-1")

        store.set(deleteSessionAtomFamily(scope), "young-1")

        expect(deleteSessionRemote).toHaveBeenCalledWith({
            sessionId: "young-1",
            projectId: "project-1",
        })
    })

    it("does not resurrect a session the server still lists (#5543 repro)", () => {
        const scope = "delete-repro"
        const store = newStoreWithSession(scope, "young-2")

        store.set(deleteSessionAtomFamily(scope), "young-2")
        // The poll that races the delete: the row is still there, auto-titled by the server.
        store.set(reconcileServerSessionsAtomFamily(scope), [
            {id: "young-2", title: "Auto-titled by the server"},
        ])

        expect(historyIds(store, scope)).toEqual([])
    })

    it("re-fires the delete on every reconcile until the server drops the row", () => {
        const scope = "delete-retry"
        const store = newStoreWithSession(scope, "young-3")

        store.set(deleteSessionAtomFamily(scope), "young-3")
        deleteSessionRemote.mockClear() // isolate the retries from the initial call

        // Delete failed (offline/5xx): the row survives, so each reconcile retries it.
        store.set(reconcileServerSessionsAtomFamily(scope), [{id: "young-3"}])
        store.set(reconcileServerSessionsAtomFamily(scope), [{id: "young-3"}])
        expect(deleteSessionRemote).toHaveBeenCalledTimes(2)

        // It lands: the server stops listing it, the tombstone is forgotten, retries stop.
        store.set(reconcileServerSessionsAtomFamily(scope), [])
        deleteSessionRemote.mockClear()
        store.set(reconcileServerSessionsAtomFamily(scope), [])
        expect(deleteSessionRemote).not.toHaveBeenCalled()
        expect(historyIds(store, scope)).toEqual([])
    })

    it("forgets the tombstone once the session is deliberately re-adopted", () => {
        const scope = "delete-readopt"
        const store = newStoreWithSession(scope, "young-5")

        store.set(deleteSessionAtomFamily(scope), "young-5")
        // Re-opened by id, e.g. from a deep link / trace — the user wants it back.
        store.set(adoptSessionAtomFamily(scope), {id: "young-5"})
        deleteSessionRemote.mockClear()

        store.set(reconcileServerSessionsAtomFamily(scope), [{id: "young-5"}])

        expect(deleteSessionRemote).not.toHaveBeenCalled()
        expect(historyIds(store, scope)).toEqual(["young-5"])
    })

    it("still adopts server sessions that were never deleted here", () => {
        const scope = "delete-adopt"
        const store = newStoreWithSession(scope, "young-4")

        store.set(deleteSessionAtomFamily(scope), "young-4")
        store.set(reconcileServerSessionsAtomFamily(scope), [
            {id: "young-4"},
            {id: "from-another-device"},
        ])

        expect(historyIds(store, scope)).toEqual(["from-another-device"])
    })
})
