/**
 * Mobile's binding of the rail's local-session seam (#6776): a session this client sent into
 * shows as a row — under its agent, spinning while it runs — until the server lists it. Only in
 * the project it was sent from.
 */
import {sessionStatusAtomFamily, setSessionStatusAtom} from "@agenta/chat/state"
import {registerLocalSessionAtom} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {localMobileSessionRefsAtom} from "@/features/nav/localSessionRefs"

describe("localMobileSessionRefsAtom", () => {
    it("lists nothing until a session is registered", () => {
        const store = createStore()
        store.set(projectIdAtom, "p1")
        expect(store.get(localMobileSessionRefsAtom)).toEqual([])
    })

    it("turns a registered session into a rail row that follows its run status", () => {
        const store = createStore()
        store.set(projectIdAtom, "p1")
        store.set(registerLocalSessionAtom, {
            sessionId: "s1",
            projectId: "p1",
            agentId: "agent-1",
            name: "Write a file",
            now: Date.UTC(2026, 8, 12, 10, 0, 0),
        })
        store.set(setSessionStatusAtom, {id: "s1", status: "running"})
        expect(store.get(sessionStatusAtomFamily("s1"))).toBe("running")
        expect(store.get(localMobileSessionRefsAtom)).toEqual([
            {
                id: "s1",
                sessionId: "s1",
                name: "Write a file",
                appId: null,
                agentId: "agent-1",
                pinned: false,
                alive: false,
                activityAt: "2026-09-12T10:00:00.000Z",
                archived: false,
                isAutomation: false,
                running: true,
                waiting: false,
            },
        ])

        store.set(setSessionStatusAtom, {id: "s1", status: "awaiting"})
        const [row] = store.get(localMobileSessionRefsAtom)
        expect(row).toMatchObject({running: false, waiting: true})
    })

    // The registry is app-wide; a pending row must stay in the project it was sent from
    // (#6783 review), or the rail would link it under the other project's URL.
    it("keeps a pending row out of another project's rail after a switch", () => {
        const store = createStore()
        store.set(projectIdAtom, "p1")
        store.set(registerLocalSessionAtom, {sessionId: "s1", projectId: "p1", name: "in A"})
        store.set(registerLocalSessionAtom, {sessionId: "s2", projectId: "p2", name: "in B"})
        expect(store.get(localMobileSessionRefsAtom).map((row) => row.sessionId)).toEqual(["s1"])

        store.set(projectIdAtom, "p2")
        expect(store.get(localMobileSessionRefsAtom).map((row) => row.sessionId)).toEqual(["s2"])

        store.set(projectIdAtom, null)
        expect(store.get(localMobileSessionRefsAtom)).toEqual([])
    })
})
