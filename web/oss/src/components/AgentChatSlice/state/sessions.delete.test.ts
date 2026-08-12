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
const archiveSessionRemote = vi.fn(async (_args: DeleteSessionRemoteArgs) => true)
const unarchiveSessionRemote = vi.fn(async (_args: DeleteSessionRemoteArgs) => true)

vi.mock("@agenta/entities/session", () => ({
    deleteSessionRemote: (args: DeleteSessionRemoteArgs) => deleteSessionRemote(args),
    archiveSessionRemote: (args: DeleteSessionRemoteArgs) => archiveSessionRemote(args),
    unarchiveSessionRemote: (args: DeleteSessionRemoteArgs) => unarchiveSessionRemote(args),
    setSessionHeader: vi.fn(async () => true),
}))

const {
    adoptSessionAtomFamily,
    archiveSessionAtomFamily,
    deleteSessionAtomFamily,
    reconcileServerSessionsAtomFamily,
    sessionHistoryAtomFamily,
    unarchiveSessionAtomFamily,
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
    archiveSessionRemote.mockClear()
    unarchiveSessionRemote.mockClear()
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

/**
 * Archive had the same `serverKnown` hole delete closed: archiving a session inside the window
 * between its first turn and the next reconcile skipped the server entirely, and the reconcile
 * then flipped the local flag back — the session reappeared in every list.
 */
describe("archiveSessionAtomFamily", () => {
    it("archives remotely even before the session is server-known", async () => {
        const scope = "archive-young"
        const store = newStoreWithSession(scope, "young-a")

        await store.set(archiveSessionAtomFamily(scope), "young-a")

        expect(archiveSessionRemote).toHaveBeenCalledWith({
            sessionId: "young-a",
            projectId: "project-1",
        })
    })

    // The caller revalidates its lists as soon as this resolves, so the write must be awaitable.
    it("resolves only once the server write settles", async () => {
        const scope = "archive-await"
        const store = newStoreWithSession(scope, "young-b")
        let landed = false
        archiveSessionRemote.mockImplementationOnce(async () => {
            await new Promise((r) => setTimeout(r, 10))
            landed = true
            return true
        })

        await store.set(archiveSessionAtomFamily(scope), "young-b")

        expect(landed).toBe(true)
    })

    it("unarchives remotely on the same terms", async () => {
        const scope = "archive-undo"
        const store = newStoreWithSession(scope, "young-c")

        await store.set(archiveSessionAtomFamily(scope), "young-c")
        await store.set(unarchiveSessionAtomFamily(scope), "young-c")

        expect(unarchiveSessionRemote).toHaveBeenCalledWith({
            sessionId: "young-c",
            projectId: "project-1",
        })
        expect(historyIds(store, scope)).toEqual(["young-c"])
    })
})
