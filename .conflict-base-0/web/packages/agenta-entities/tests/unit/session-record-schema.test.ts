/**
 * Pins the session-record wire→internal remap. The backend renamed the record envelope
 * (`id→record_id`, `event_index→record_index`, `sender→record_source`,
 * `session_update→record_type`, `payload→attributes`); because the FE schema declared the
 * old names as `.nullish()`, zod silently STRIPPED the unknown wire keys and passed
 * validation with `payload`/`sender`/`id` all `undefined` — so `transcriptToMessages` bailed
 * on every row and record replay was silently dead (tsc stayed green). These tests assert the
 * transform maps the real wire shape to the names the adapter reads, so a future rename can't
 * reintroduce the silent break.
 */
import {describe, expect, it} from "vitest"

import {sessionRecordSchema, sessionRecordsQueryResponseSchema} from "../../src/session/core/schema"

/** A record row exactly as the backend serializes it today (post-rename envelope). */
const wireRecord = {
    record_id: "rec-1",
    session_id: "sess-1",
    project_id: "proj-1",
    record_index: 3,
    record_source: "runner",
    record_type: "message",
    attributes: {type: "message", text: "hello"},
    timestamp: "2026-07-07T00:00:00Z",
    created_at: "2026-07-07T00:00:01Z",
}

describe("sessionRecordSchema", () => {
    it("maps the renamed wire envelope to the consumer-facing names", () => {
        const out = sessionRecordSchema.parse(wireRecord)
        // The three fields transcriptToMessages reads MUST be populated, not stripped-to-undefined.
        expect(out.id).toBe("rec-1")
        expect(out.sender).toBe("runner")
        expect(out.payload).toEqual({type: "message", text: "hello"})
        expect(out.event_index).toBe(3)
        expect(out.session_update).toBe("message")
        expect(out.created_at).toBe("2026-07-07T00:00:01Z")
    })

    it("passes the opaque AgentEvent through `attributes` verbatim (incl. interaction_request)", () => {
        const approval = {
            ...wireRecord,
            record_type: "interaction_request",
            attributes: {
                type: "interaction_request",
                kind: "user_approval",
                id: "int-9",
                payload: {toolCallId: "call-1", toolCall: {name: "send_email"}},
            },
        }
        const out = sessionRecordSchema.parse(approval)
        expect(out.payload).toEqual(approval.attributes)
    })

    it("tolerates absent optionals (nullish) without dropping the payload", () => {
        const minimal = {
            record_id: "rec-2",
            session_id: "sess-1",
            project_id: "proj-1",
            attributes: {type: "thought", text: "…"},
        }
        const out = sessionRecordSchema.parse(minimal)
        expect(out.id).toBe("rec-2")
        expect(out.payload).toEqual({type: "thought", text: "…"})
        expect(out.sender).toBeNull()
    })

    it("validates the query response envelope and remaps each record", () => {
        const out = sessionRecordsQueryResponseSchema.parse({count: 1, records: [wireRecord]})
        expect(out.count).toBe(1)
        expect(out.records[0].payload).toEqual({type: "message", text: "hello"})
    })
})
