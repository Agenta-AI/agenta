import {describe, expect, it} from "vitest"

import {dropArchivedAgentSessions, withActiveLocalSession} from "./sessionsSource"
import type {SessionSidebarRef} from "./sessionsSource"

const ref = (over: Partial<SessionSidebarRef> & {id: string}): SessionSidebarRef => ({
    sessionId: over.id,
    name: over.id,
    appId: null,
    pinned: false,
    alive: false,
    running: false,
    agentName: null,
    ...over,
})

const ARCHIVED = new Set(["agent-archived"])

describe("dropArchivedAgentSessions", () => {
    it("drops sessions whose agent is archived", () => {
        const kept = dropArchivedAgentSessions(
            [ref({id: "a", appId: "agent-archived"}), ref({id: "b", appId: "agent-live"})],
            ARCHIVED,
        )

        expect(kept.map((r) => r.id)).toEqual(["b"])
    })

    // A pin is an explicit user request, the same exemption it gets from every other list rule.
    it("keeps a PINNED session even when its agent is archived", () => {
        const kept = dropArchivedAgentSessions(
            [ref({id: "pinned", appId: "agent-archived", pinned: true})],
            ARCHIVED,
        )

        expect(kept.map((r) => r.id)).toEqual(["pinned"])
    })

    it("keeps sessions that have no agent at all", () => {
        const kept = dropArchivedAgentSessions([ref({id: "orphan", appId: null})], ARCHIVED)

        expect(kept.map((r) => r.id)).toEqual(["orphan"])
    })

    // Absence of evidence is not evidence of archival: until the archived-ids query answers there
    // is no set at all, and a pending query must never blank the group.
    it("keeps everything until the archived answer arrives (null)", () => {
        const refs = [ref({id: "a", appId: "agent-archived"}), ref({id: "b", appId: "agent-live"})]

        expect(dropArchivedAgentSessions(refs, null).map((r) => r.id)).toEqual(["a", "b"])
    })

    // The filter runs before the visible cap, so a live session behind archived ones still lands
    // in the rendered slots rather than losing them to rows that will never be shown.
    it("frees capped slots for live sessions", () => {
        const refs = [
            ...Array.from({length: 3}, (_, i) => ref({id: `arch-${i}`, appId: "agent-archived"})),
            ref({id: "live", appId: "agent-live"}),
        ]

        expect(dropArchivedAgentSessions(refs, ARCHIVED).map((r) => r.id)).toEqual(["live"])
    })
})

describe("withActiveLocalSession", () => {
    // The bug this exists for: a just-created session is client-side only until its first turn
    // runs, so the server-backed list cannot contain it and the sidebar showed nothing.
    it("adds the open session when the server list has never heard of it", () => {
        const merged = withActiveLocalSession(
            [ref({id: "served"})],
            ref({id: "fresh", appId: "agent-1"}),
        )

        expect(merged.map((r) => r.id)).toEqual(["fresh", "served"])
    })

    // The server row carries the title, preview and liveness the local one cannot know.
    it("keeps the server row when both describe the same session", () => {
        const merged = withActiveLocalSession(
            [ref({id: "shared", name: "Real title", alive: true})],
            ref({id: "shared", name: null}),
        )

        expect(merged).toHaveLength(1)
        expect(merged[0].name).toBe("Real title")
        expect(merged[0].alive).toBe(true)
    })

    it("leads the unpinned rows without displacing pins", () => {
        const merged = withActiveLocalSession(
            [ref({id: "pin-a", pinned: true}), ref({id: "pin-b", pinned: true}), ref({id: "old"})],
            ref({id: "fresh"}),
        )

        expect(merged.map((r) => r.id)).toEqual(["pin-a", "pin-b", "fresh", "old"])
    })

    it("appends when every row is pinned", () => {
        const merged = withActiveLocalSession([ref({id: "pin", pinned: true})], ref({id: "fresh"}))

        expect(merged.map((r) => r.id)).toEqual(["pin", "fresh"])
    })

    // Off a playground there is no open session — the empty-session filter must keep its full
    // reach, so nothing is exempted.
    it("changes nothing when no session is open", () => {
        const refs = [ref({id: "a"}), ref({id: "b"})]

        expect(withActiveLocalSession(refs, null).map((r) => r.id)).toEqual(["a", "b"])
    })
})
