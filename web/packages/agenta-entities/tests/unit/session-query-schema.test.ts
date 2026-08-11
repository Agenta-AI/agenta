/**
 * Pins the `/sessions/query` wire shape for `sessionStreamSchema`/`sessionsQueryResponseSchema`.
 *
 * Fern's compile-time types under-declare backend `extra="allow"` fields and don't catch
 * server-side field renames, and zod silently STRIPS unknown wire keys to `undefined` on a
 * `.nullish()` field — so a renamed backend key (e.g. `name`, `references`) tsc-passes and
 * parse-succeeds while the FE session list silently loses the data (this class of drift has
 * bitten the session schemas twice: see `session-record-schema.test.ts`). These tests assert
 * a realistic wire payload survives parsing with its values intact, and document — via a
 * deliberately-renamed fixture — that a real rename would slip past zod undetected unless
 * this fixture is kept in sync with an actual backend payload.
 */
import {describe, expect, it} from "vitest"

import {sessionsQueryResponseSchema, sessionStreamSchema} from "../../src/session/core/schema"

/** A fully-populated `/sessions/query` row exactly as the backend serializes it today:
 * `SessionListItem` (`SessionStream` + `Identifier`/`Header`/`Lifecycle` + `references`),
 * `response_model_exclude_none=True` on the route so nulled optionals are simply absent. */
const wireRow = {
    id: "22222222-2222-2222-2222-222222222222",
    project_id: "11111111-1111-1111-1111-111111111111",
    session_id: "sess-1",
    name: "Refactor the auth flow",
    description: "First user message becomes the session title",
    flags: {is_alive: true, is_running: false, is_attached: false},
    tags: {priority: "high"},
    meta: {source: "web"},
    turn_id: "turn-7",
    created_at: "2026-07-20T10:00:00Z",
    updated_at: "2026-07-24T09:30:00Z",
    references: [
        {id: "33333333-3333-3333-3333-333333333333", slug: "support-router", version: "v3"},
    ],
}

const wireEnvelope = {count: 1, sessions: [wireRow]}

const typedWireEnvelope = {
    count: 1,
    total: 12,
    sessions: [
        {
            ...wireRow,
            origin: "trigger",
            trigger: {
                id: "44444444-4444-4444-4444-444444444444",
                kind: "schedule",
                name: "Nightly digest",
            },
            delivery: {id: "55555555-5555-5555-5555-555555555555"},
            last_message: {
                text: "Digest delivered.",
                source: "agent",
                timestamp: "2026-07-24T09:30:00Z",
            },
        },
    ],
    windowing: {
        next: "22222222-2222-2222-2222-222222222222",
        newest: "2026-07-24T09:30:00Z",
        limit: 1,
        order: "descending",
    },
}

describe("sessionStreamSchema (/sessions/query rows)", () => {
    it("parses a fully-populated stamped row and keeps the fields the session list reads", () => {
        const out = sessionStreamSchema.parse(wireRow)
        expect(out.session_id).toBe("sess-1")
        expect(out.name).toBe("Refactor the auth flow")
        expect(out.flags).toEqual({is_alive: true, is_running: false, is_attached: false})
        expect(out.updated_at).toBe("2026-07-24T09:30:00Z")
        expect(out.references?.[0]?.id).toBe("33333333-3333-3333-3333-333333333333")
        expect(out.references?.[0]?.slug).toBe("support-router")
        expect(out.references?.[0]?.version).toBe("v3")
    })

    it("parses the minimum row (only the three non-nullish fields) with everything else undefined", () => {
        // `id`/`project_id`/`session_id` are the schema's only required fields — every other
        // field is `.nullish()`. This is the legacy/never-turned session shape.
        const minimal = {
            id: "22222222-2222-2222-2222-222222222222",
            project_id: "11111111-1111-1111-1111-111111111111",
            session_id: "sess-legacy",
        }
        const out = sessionStreamSchema.parse(minimal)
        expect(out.session_id).toBe("sess-legacy")
        expect(out.name).toBeUndefined()
        expect(out.description).toBeUndefined()
        expect(out.flags).toBeUndefined()
        expect(out.turn_id).toBeUndefined()
        expect(out.created_at).toBeUndefined()
        expect(out.updated_at).toBeUndefined()
        expect(out.deleted_at).toBeUndefined()
        expect(out.archived_at).toBeUndefined()
        expect(out.references).toBeUndefined()
    })

    it("parses an include_ended (soft-deleted) row and keeps deleted_at + flags", () => {
        const deleted = {
            ...wireRow,
            session_id: "sess-ended",
            deleted_at: "2026-07-23T12:00:00Z",
            flags: {is_alive: false, is_running: false, is_attached: false},
        }
        const out = sessionStreamSchema.parse(deleted)
        expect(out.deleted_at).toBe("2026-07-23T12:00:00Z")
        expect(out.flags).toEqual({is_alive: false, is_running: false, is_attached: false})
    })

    it("parses an archived row and keeps archived_at distinct from deleted_at", () => {
        const archived = {
            ...wireRow,
            session_id: "sess-archived",
            archived_at: "2026-07-22T08:15:00Z",
        }
        const out = sessionStreamSchema.parse(archived)
        expect(out.archived_at).toBe("2026-07-22T08:15:00Z")
        expect(out.deleted_at).toBeUndefined()
    })

    it("parses a row with no references key at all (exclude_none: no turns yet)", () => {
        const {references: _references, ...noRefs} = wireRow
        const out = sessionStreamSchema.parse(noRefs)
        expect(out.references).toBeUndefined()
    })
})

describe("sessionsQueryResponseSchema (envelope)", () => {
    it("parses {count, sessions} and each row through sessionStreamSchema", () => {
        const out = sessionsQueryResponseSchema.parse(wireEnvelope)
        expect(out.count).toBe(1)
        expect(out.sessions).toHaveLength(1)
        expect(out.sessions[0].session_id).toBe("sess-1")
        expect(out.sessions[0].references?.[0]?.id).toBe("33333333-3333-3333-3333-333333333333")
    })

    it("keeps typed attribution, preview, total, and response windowing", () => {
        const out = sessionsQueryResponseSchema.parse(typedWireEnvelope)
        expect(out.total).toBe(12)
        expect(out.sessions[0].origin).toBe("trigger")
        expect(out.sessions[0].trigger).toEqual({
            id: "44444444-4444-4444-4444-444444444444",
            kind: "schedule",
            name: "Nightly digest",
        })
        expect(out.sessions[0].delivery?.id).toBe("55555555-5555-5555-5555-555555555555")
        expect(out.sessions[0].last_message?.text).toBe("Digest delivered.")
        expect(out.windowing).toEqual({
            next: "22222222-2222-2222-2222-222222222222",
            newest: "2026-07-24T09:30:00Z",
            limit: 1,
            order: "descending",
        })
    })

    it("accepts rollout responses without additive typed or envelope fields", () => {
        const out = sessionsQueryResponseSchema.parse(wireEnvelope)
        expect(out.total).toBeUndefined()
        expect(out.windowing).toBeUndefined()
        expect(out.sessions[0].origin).toBeUndefined()
        expect(out.sessions[0].trigger).toBeUndefined()
        expect(out.sessions[0].delivery).toBeUndefined()
        expect(out.sessions[0].last_message).toBeUndefined()
    })
})

describe("drift guard: a renamed wire key is silently dropped, not rejected", () => {
    // This is the failure mode the whole file exists to catch early: zod schemas built from
    // `.nullish()` fields don't fail on an unknown key, they just parse it away. If the backend
    // ever renames `name` or `references` the way it once renamed the record envelope (see
    // `session-record-schema.test.ts`), THIS test's fixture (`wireRow` above) must be updated
    // from a real payload — at which point the assertions in the "fully-populated" case above
    // (`out.name`, `out.references?.[0]?.id`) start failing and catch the drift. The cases below
    // do not test correct behavior; they document what a silent break would look like today.
    it("dropping `name` in favor of a renamed key parses clean but loses the title", () => {
        const {name: _name, ...rest} = wireRow
        const renamed = {...rest, header_name: "Refactor the auth flow"}
        const out = sessionStreamSchema.parse(renamed)
        expect(out.name).toBeUndefined()
        expect((out as Record<string, unknown>).header_name).toBeUndefined()
    })

    it("dropping `references` in favor of a renamed key parses clean but loses the reference list", () => {
        const {references: _references, ...rest} = wireRow
        const renamed = {...rest, refs: wireRow.references}
        const out = sessionStreamSchema.parse(renamed)
        expect(out.references).toBeUndefined()
        expect((out as Record<string, unknown>).refs).toBeUndefined()
    })
})
