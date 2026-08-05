/**
 * Unit tests for `extractSessionIdFromPayload` — the read-back path that lifts the
 * runner-minted backend session_id off a run response (sibling of trace/span extraction).
 * The playground sends no session_id; the runner mints+persists it and echoes it back,
 * and this is how the panel captures it.
 */
import {describe, expect, it} from "vitest"

import {extractSessionIdFromPayload} from "../../src/state/execution/trace"

describe("extractSessionIdFromPayload", () => {
    it("reads a top-level snake_case session_id", () => {
        expect(extractSessionIdFromPayload({session_id: "sess-123"})).toBe("sess-123")
    })

    it("reads a top-level camelCase sessionId", () => {
        expect(extractSessionIdFromPayload({sessionId: "sess-abc"})).toBe("sess-abc")
    })

    it("finds it nested under response/result/output", () => {
        expect(extractSessionIdFromPayload({response: {session_id: "nested"}})).toBe("nested")
        expect(extractSessionIdFromPayload({result: {sessionId: "r"}})).toBe("r")
        expect(extractSessionIdFromPayload({output: {session_id: "o"}})).toBe("o")
    })

    it("finds it under status/detail/metadata", () => {
        expect(extractSessionIdFromPayload({status: {session_id: "s"}})).toBe("s")
        expect(extractSessionIdFromPayload({detail: {sessionId: "d"}})).toBe("d")
        expect(extractSessionIdFromPayload({metadata: {session_id: "m"}})).toBe("m")
    })

    it("returns null when absent", () => {
        expect(extractSessionIdFromPayload({foo: "bar"})).toBeNull()
        expect(extractSessionIdFromPayload(null)).toBeNull()
        expect(extractSessionIdFromPayload(undefined)).toBeNull()
        expect(extractSessionIdFromPayload("just a string")).toBeNull()
    })

    it("ignores empty / non-string session ids", () => {
        expect(extractSessionIdFromPayload({session_id: "   "})).toBeNull()
        expect(extractSessionIdFromPayload({session_id: 42})).toBeNull()
    })

    it("does not confuse the playground UI column key shape (still reads whatever is present)", () => {
        // "sess:<runnableId>" must never be SENT, but if a backend echoes a real id we take it.
        expect(extractSessionIdFromPayload({session_id: "real-backend-id"})).toBe("real-backend-id")
    })
})
