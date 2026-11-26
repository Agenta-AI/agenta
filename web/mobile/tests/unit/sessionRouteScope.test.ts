import {
    applySessionScopeAtom,
    sessionAgentFilterAtom,
    sessionSearchAtom,
    sessionShowTriggeredAtom,
} from "@agenta/sessions/state"
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {sessionScopeFromRoute} from "@/features/sessions/sessionRouteScope"

describe("sessionScopeFromRoute", () => {
    it("agent in the URL scopes the sessions list to that agent", () => {
        const store = createStore()

        store.set(applySessionScopeAtom, sessionScopeFromRoute({agent: "a1"}, true)!)

        expect(store.get(sessionAgentFilterAtom)).toBe("a1")
    })

    it("agent and mode together keep automation runs and the agent", () => {
        const store = createStore()

        store.set(
            applySessionScopeAtom,
            sessionScopeFromRoute({mode: "automation", agent: "a1"}, true)!,
        )

        expect(store.get(sessionShowTriggeredAtom)).toBe(true)
        expect(store.get(sessionAgentFilterAtom)).toBe("a1")
    })

    it("agent in the URL is ignored while the view is disabled", () => {
        expect(sessionScopeFromRoute({agent: "a1"}, false)).toBeUndefined()
        expect(sessionScopeFromRoute({mode: "automation", agent: "a1"}, false)).toEqual({
            origin: "trigger",
        })
    })

    it("the search draft is cleared when the agent scope applies", () => {
        const store = createStore()
        store.set(sessionSearchAtom, "foo")

        store.set(applySessionScopeAtom, sessionScopeFromRoute({agent: "a1"}, true)!)

        expect(store.get(sessionSearchAtom)).toBe("")
    })
})
