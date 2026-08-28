/**
 * Only an explicit open lets a session become a tab (#6295).
 *
 * The strip used to treat "this scope has no open list yet" as "every session in history is open".
 * The reconciler folds the agent's whole server list into history — automations, crons and every
 * ended run included — so tabs appeared on their own, one per background run, and nothing ever
 * left the fallback because reconcile does not write the open list.
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {projectIdAtom} from "@/oss/state/project"

const {
    addSessionAtomFamily,
    closeSessionAtomFamily,
    openSessionAtomFamily,
    reconcileServerSessionsAtomFamily,
    sessionsListAtomFamily,
    sessionHistoryAtomFamily,
} = await import("./sessions")

const SCOPE = "app-auto-open"

const newStore = () => {
    const store = createStore()
    store.set(projectIdAtom, "project-1")
    return store
}

const tabIds = (store: ReturnType<typeof createStore>) =>
    store.get(sessionsListAtomFamily(SCOPE)).map((s) => s.id)

const historyIds = (store: ReturnType<typeof createStore>) =>
    store.get(sessionHistoryAtomFamily(SCOPE)).map((s) => s.id)

/** What an automation run looks like once the reconciler has seen it. */
const serverSession = (id: string) => ({id, title: `run ${id}`, lastMessageAt: 1, ended: true})

describe("open tabs come only from an explicit open", () => {
    it("gives a scope no tabs before anything opens one", () => {
        expect(tabIds(newStore())).toEqual([])
    })

    it("does not open a tab for a server session it has never seen", () => {
        const store = newStore()
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [
            serverSession("cron-1"),
            serverSession("cron-2"),
        ])
        expect(historyIds(store)).toEqual(["cron-1", "cron-2"])
        expect(tabIds(store)).toEqual([])
    })

    it("leaves the open tabs alone as the server list grows", () => {
        const store = newStore()
        store.set(addSessionAtomFamily(SCOPE), {id: "mine"})
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [
            serverSession("cron-1"),
            {id: "mine", lastMessageAt: 2},
        ])
        expect(tabIds(store)).toEqual(["mine"])
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [
            serverSession("cron-1"),
            serverSession("cron-2"),
            {id: "mine", lastMessageAt: 3},
        ])
        expect(tabIds(store)).toEqual(["mine"])
    })

    it("still opens a reconciled session on request, and closing it is final", () => {
        const store = newStore()
        store.set(addSessionAtomFamily(SCOPE), {id: "mine"})
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [serverSession("cron-1")])
        store.set(openSessionAtomFamily(SCOPE), "cron-1")
        expect(tabIds(store)).toEqual(["mine", "cron-1"])

        store.set(closeSessionAtomFamily(SCOPE), "cron-1")
        expect(tabIds(store)).toEqual(["mine"])
        // Closed, not deleted: it stays reopenable from history, and stays closed across reconciles.
        expect(historyIds(store)).toContain("cron-1")
        store.set(reconcileServerSessionsAtomFamily(SCOPE), [
            serverSession("cron-1"),
            {id: "mine", lastMessageAt: 4},
        ])
        expect(tabIds(store)).toEqual(["mine"])
    })

    it("keeps each project's open tabs to itself", () => {
        const store = newStore()
        store.set(addSessionAtomFamily(SCOPE), {id: "mine"})
        store.set(projectIdAtom, "project-2")
        expect(tabIds(store)).toEqual([])
        store.set(projectIdAtom, "project-1")
        expect(tabIds(store)).toEqual(["mine"])
    })
})
