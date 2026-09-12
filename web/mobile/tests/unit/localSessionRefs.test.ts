/**
 * Mobile's binding of the rail's local-session seam (#6776): a session this client sent into
 * shows as a row — under its agent, spinning while it runs — until the server lists it.
 */
import {sessionStatusAtomFamily, setSessionStatusAtom} from "@agenta/chat/state"
import {registerLocalSessionAtom} from "@agenta/entities/session"
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {localMobileSessionRefsAtom} from "@/features/nav/localSessionRefs"

describe("localMobileSessionRefsAtom", () => {
    it("lists nothing until a session is registered", () => {
        expect(createStore().get(localMobileSessionRefsAtom)).toEqual([])
    })

    it("turns a registered session into a rail row that follows its run status", () => {
        const store = createStore()
        store.set(registerLocalSessionAtom, {
            sessionId: "s1",
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
})
