import {sessionStatusAtomFamily, setSessionStatusAtom} from "@agenta/chat/state"
import {createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

import {projectIdAtom} from "@/oss/state/project"

import {
    addSessionAtomFamily,
    archiveSessionAtomFamily,
    closeSessionAtomFamily,
    deleteSessionAtomFamily,
    pruneSessionHusksAtomFamily,
    activeSessionIdAtomFamily,
    openSessionIdsAtomFamily,
    reconcileServerSessionsAtomFamily,
    resetScopeAtomFamily,
    setActiveSessionAtomFamily,
} from "./sessions"

// The registry owns a live `Chat`; what's under test is the CONTRACT it imposes on this file — that
// every writer which makes a session unreachable also tears its runtime down. A session can die
// while its pane is unmounted (another route, another device), and then these writers are the only
// teardown signal there is.
vi.mock("@agenta/chat/state", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@agenta/chat/state")>()),
    dropSessionChat: vi.fn(),
}))
const {dropSessionChat} = await import("@agenta/chat/state")
const dropped = dropSessionChat as ReturnType<typeof vi.fn>

let seq = 0
/** A scope of its own per test — these atoms are backed by shared localStorage-ish state. */
const freshScope = () => `teardown-${(seq += 1)}`

/** The session storage atoms are project-scoped, so a bare store would hold nothing. */
const newStore = () => {
    const store = createStore()
    store.set(projectIdAtom, "project-1")
    return store
}

/** Two open, server-known sessions in one scope (one reconcile, so neither drops the other). */
const twoRunningSessions = (store: ReturnType<typeof createStore>, scope: string) => {
    const first = store.set(addSessionAtomFamily(scope))
    const second = store.set(addSessionAtomFamily(scope))
    store.set(reconcileServerSessionsAtomFamily(scope), [
        {id: first, title: "S"},
        {id: second, title: "S"},
    ])
    store.set(setSessionStatusAtom, {id: first, status: "running"})
    store.set(setSessionStatusAtom, {id: second, status: "running"})
    return {first, second}
}

/** A session that is open, server-known, and reported as running by this browser. */
const runningSession = (store: ReturnType<typeof createStore>, scope: string) => {
    const id = store.set(addSessionAtomFamily(scope))
    store.set(reconcileServerSessionsAtomFamily(scope), [{id, title: "S"}])
    store.set(setSessionStatusAtom, {id, status: "running"})
    return id
}

beforeEach(() => {
    dropped.mockClear()
})

describe("session teardown drops the live chat", () => {
    it.each([
        ["closing the tab", closeSessionAtomFamily],
        ["deleting the session", deleteSessionAtomFamily],
        ["archiving the session", archiveSessionAtomFamily],
    ])("%s", (_label, writerFamily) => {
        const store = newStore()
        const scope = freshScope()
        const id = runningSession(store, scope)

        store.set(writerFamily(scope), id)

        expect(dropped).toHaveBeenCalledWith(id)
        // The chat is gone, so its own `onFinish` can no longer retire the dot — this writer must.
        expect(store.get(sessionStatusAtomFamily(id))).toBe("idle")
    })

    it("resetting a scope drops every session in it", () => {
        const store = newStore()
        const scope = freshScope()
        const first = runningSession(store, scope)
        const second = runningSession(store, scope)

        store.set(resetScopeAtomFamily(scope))

        expect(dropped).toHaveBeenCalledWith(first)
        expect(dropped).toHaveBeenCalledWith(second)
        expect(store.get(sessionStatusAtomFamily(first))).toBe("idle")
        expect(store.get(sessionStatusAtomFamily(second))).toBe("idle")
    })

    it("reconciling drops a session deleted on another device", () => {
        const store = newStore()
        const scope = freshScope()
        const id = runningSession(store, scope)

        store.set(reconcileServerSessionsAtomFamily(scope), [])

        expect(dropped).toHaveBeenCalledWith(id)
        expect(store.get(sessionStatusAtomFamily(id))).toBe("idle")
    })

    it("reconciling drops a session archived on another device", () => {
        const store = newStore()
        const scope = freshScope()
        const id = runningSession(store, scope)

        // The tab list hides an archived session from here on, so its pane never unmounts again.
        store.set(reconcileServerSessionsAtomFamily(scope), [{id, title: "S", archived: true}])

        expect(dropped).toHaveBeenCalledWith(id)
        expect(store.get(sessionStatusAtomFamily(id))).toBe("idle")
    })

    it("reconciling an archive from another device closes its tab and re-points active", () => {
        const store = newStore()
        const scope = freshScope()
        const {first: stays, second: archived} = twoRunningSessions(store, scope)
        store.set(setActiveSessionAtomFamily(scope), archived)
        expect(store.get(activeSessionIdAtomFamily(scope))).toBe(archived)

        store.set(reconcileServerSessionsAtomFamily(scope), [
            {id: stays, title: "S"},
            {id: archived, title: "S", archived: true},
        ])

        // Dropping the chat is not enough: the tab list stops showing an archived session, so
        // leaving it open/active renders an archived session as the active pane.
        expect([...store.get(openSessionIdsAtomFamily(scope))]).not.toContain(archived)
        expect(store.get(activeSessionIdAtomFamily(scope))).toBe(stays)
    })

    it("reconciling an archive leaves the active tab alone when it was not the archived one", () => {
        const store = newStore()
        const scope = freshScope()
        const {first: archived, second: active} = twoRunningSessions(store, scope)
        store.set(setActiveSessionAtomFamily(scope), active)

        store.set(reconcileServerSessionsAtomFamily(scope), [
            {id: archived, title: "S", archived: true},
            {id: active, title: "S"},
        ])

        expect(store.get(activeSessionIdAtomFamily(scope))).toBe(active)
        expect([...store.get(openSessionIdsAtomFamily(scope))]).toContain(active)
    })

    it("reconciling leaves an already-archived session alone", () => {
        const store = newStore()
        const scope = freshScope()
        const id = runningSession(store, scope)
        store.set(reconcileServerSessionsAtomFamily(scope), [{id, title: "S", archived: true}])
        dropped.mockClear()

        // A later poll repeats the same flag; only the transition is a teardown signal.
        store.set(reconcileServerSessionsAtomFamily(scope), [
            {id, title: "S", archived: true, lastMessageAt: 1},
        ])

        expect(dropped).not.toHaveBeenCalled()
    })

    it("pruning husks drops no chat, because a husk never had one", () => {
        const store = newStore()
        const scope = freshScope()
        const id = store.set(addSessionAtomFamily(scope))
        store.set(closeSessionAtomFamily(scope), id)
        dropped.mockClear()

        store.set(pruneSessionHusksAtomFamily(scope))

        // Prune only touches sessions that are already closed, and closing dropped the chat. This
        // asserts the invariant that keeps the missing call here correct rather than accidental.
        expect(dropped).not.toHaveBeenCalled()
    })
})
