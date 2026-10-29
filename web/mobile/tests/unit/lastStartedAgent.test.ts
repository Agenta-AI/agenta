/**
 * #6741: Home binds the agent a chat was LAST STARTED with, not the head of the roster.
 *
 * The roster is newest-first, so before this a workspace with two agents opened every visit on
 * whichever was created last. The memory is per project and only ever a preference: an agent
 * archived since is skipped, and the page falls back to the roster head as before.
 */
import {resolveBoundAgentId} from "@agenta/home-ui"
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {lastStartedAgentIdAtom, rememberStartedAgentAtom} from "@/features/home/lastStartedAgent"

const agents = [{id: "newest"}, {id: "older"}, {id: "oldest"}]

describe("resolveBoundAgentId", () => {
    it("binds the roster head when nothing is chosen or remembered", () => {
        expect(resolveBoundAgentId(agents, null, null)).toBe("newest")
    })

    it("binds the remembered agent over the roster head", () => {
        expect(resolveBoundAgentId(agents, null, "older")).toBe("older")
    })

    it("lets an explicit pick win over the memory", () => {
        expect(resolveBoundAgentId(agents, "oldest", "older")).toBe("oldest")
    })

    it("skips a remembered agent no longer in the roster", () => {
        expect(resolveBoundAgentId(agents, null, "archived")).toBe("newest")
    })

    it("binds nothing on an empty roster", () => {
        expect(resolveBoundAgentId([], null, "older")).toBeNull()
    })
})

describe("lastStartedAgent store", () => {
    it("remembers per project and answers null elsewhere", () => {
        const store = createStore()
        store.set(rememberStartedAgentAtom, {projectId: "p1", agentId: "older"})
        expect(store.get(lastStartedAgentIdAtom("p1"))).toBe("older")
        expect(store.get(lastStartedAgentIdAtom("p2"))).toBeNull()
    })

    it("the latest start replaces the memory", () => {
        const store = createStore()
        store.set(rememberStartedAgentAtom, {projectId: "p1", agentId: "older"})
        store.set(rememberStartedAgentAtom, {projectId: "p1", agentId: "oldest"})
        expect(store.get(lastStartedAgentIdAtom("p1"))).toBe("oldest")
    })
})
