import {describe, expect, it} from "vitest"

import {dropArchivedAgentSessions} from "./sessionsSource"
import type {SessionSidebarRef} from "./sessionsSource"

const ref = (over: Partial<SessionSidebarRef> & {id: string}): SessionSidebarRef => ({
    sessionId: over.id,
    name: over.id,
    appId: null,
    pinned: false,
    alive: false,
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
