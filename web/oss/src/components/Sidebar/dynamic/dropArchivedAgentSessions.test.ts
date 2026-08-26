import {dropArchivedAgentSessions, withLocalSessions} from "@agenta/navigation"
import type {SessionSidebarRef} from "@agenta/navigation"
import {describe, expect, it} from "vitest"

const ref = (over: Partial<SessionSidebarRef> & {id: string}): SessionSidebarRef => ({
    sessionId: over.id,
    name: over.id,
    appId: null,
    agentId: null,
    pinned: false,
    alive: false,
    running: false,
    archived: false,
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

/**
 * A session's row can only come from the local tab store until its FIRST turn lands: the server row
 * carries no `references` before then, so `sessionOpenTarget` rejects it and the server-backed list
 * drops it. What goes in that local set decides which sessions the sidebar can show at all.
 */
describe("withLocalSessions", () => {
    it("adds a session the server list has never heard of", () => {
        const merged = withLocalSessions([ref({id: "served"})], [ref({id: "fresh"})])

        expect(merged.map((r) => r.id)).toEqual(["fresh", "served"])
    })

    // The server row carries the title, preview and liveness the local one cannot know.
    it("keeps the server row when both describe the same session", () => {
        const merged = withLocalSessions(
            [ref({id: "shared", name: "Real title", alive: true})],
            [ref({id: "shared", name: null})],
        )

        expect(merged).toHaveLength(1)
        expect(merged[0].name).toBe("Real title")
        expect(merged[0].alive).toBe(true)
    })

    // The regression: keying this on the ACTIVE session alone meant switching tabs mid-first-turn
    // dropped the running session's row, taking its spinner with it.
    it("keeps a running session alongside the one now active", () => {
        const merged = withLocalSessions(
            [ref({id: "served"})],
            [ref({id: "now-active"}), ref({id: "still-running"})],
        )

        expect(merged.map((r) => r.id)).toEqual(["now-active", "still-running", "served"])
    })

    it("leads the unpinned rows without displacing pins", () => {
        const merged = withLocalSessions(
            [ref({id: "pin-a", pinned: true}), ref({id: "pin-b", pinned: true}), ref({id: "old"})],
            [ref({id: "fresh"})],
        )

        expect(merged.map((r) => r.id)).toEqual(["pin-a", "pin-b", "fresh", "old"])
    })

    it("appends when every row is pinned", () => {
        const merged = withLocalSessions([ref({id: "pin", pinned: true})], [ref({id: "fresh"})])

        expect(merged.map((r) => r.id)).toEqual(["pin", "fresh"])
    })

    // Off a playground nothing is exempted, so the empty-session filter keeps its full reach.
    it("changes nothing when there are no local sessions", () => {
        const refs = [ref({id: "a"}), ref({id: "b"})]

        expect(withLocalSessions(refs, []).map((r) => r.id)).toEqual(["a", "b"])
    })

    // A row key IS the session id, so a twin renders two rows that both take the selected pill.
    it("keeps one row when the same session arrives twice", () => {
        const merged = withLocalSessions([ref({id: "twin"}), ref({id: "twin"})], [])

        expect(merged.map((r) => r.id)).toEqual(["twin"])
    })

    // The server row is polled, so a turn running in THIS browser reads as idle on it.
    it("takes liveness from the host row when the server already knows the session", () => {
        const merged = withLocalSessions(
            [ref({id: "shared"})],
            [ref({id: "shared", running: true})],
        )

        expect(merged.map((r) => [r.id, r.running])).toEqual([["shared", true]])
    })

    it("keeps one row when a local session repeats", () => {
        const merged = withLocalSessions([], [ref({id: "local"}), ref({id: "local"})])

        expect(merged.map((r) => r.id)).toEqual(["local"])
    })
})
