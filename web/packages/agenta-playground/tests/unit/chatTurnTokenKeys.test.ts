/**
 * Regression tests for issue #5789 -- token-usage numbers identical across
 * every chat turn in a session.
 *
 * Three bugs caused the symptom:
 *
 * 1. `extractLogicalRowId` in webWorkerIntegration used a regex that only
 *    matched "lt-" prefixed logical IDs; current message IDs start with "msg-",
 *    so the function returned the full compound turn ID unchanged.  The wrong
 *    ID was then used as the execution step key, making all turns collide on
 *    the last shared user message.
 *
 * 2. `handleExecutionResultAtom` in executionItems only searched for "-lt-" to
 *    locate the logical boundary in a compound "turn-<entityId>-<logicalId>"
 *    rowId.  Same root cause; fallback always resolved to the last shared user
 *    message, so every turn wrote its result at the same key and therefore
 *    showed the same trace / same token counts.
 *
 * 3. `runStatusByRowEntityAtom` in selectors sliced result keys with
 *    `sepIdx + 5` instead of `sepIdx + 6`, leaving a leading ":" on the
 *    entityId segment and producing a malformed lookup key that could never
 *    match the UI-side `"${rowId}:${entityId}"` key.
 */

import {describe, expect, it} from "vitest"

import {extractLogicalRowId} from "../../src/state/execution/webWorkerIntegration"

// ── extractLogicalRowId (Bug 1 fix) ─────────────────────────────────────────

describe("extractLogicalRowId", () => {
    it("returns a plain msg-<uuid> rowId unchanged (single-entity mode)", () => {
        expect(extractLogicalRowId("msg-abc123")).toBe("msg-abc123")
    })

    it("returns a plain lt-<id> rowId unchanged (legacy single-entity)", () => {
        expect(extractLogicalRowId("lt-old-id")).toBe("lt-old-id")
    })

    it("strips the turn-<entityId>- prefix from a current msg-<uuid> logical ID", () => {
        expect(extractLogicalRowId("turn-rev1-msg-abc123")).toBe("msg-abc123")
    })

    it("handles a UUID entity ID with hyphens in the compound rowId", () => {
        // Entity IDs are hex UUIDs; "msg-" cannot appear in a UUID segment,
        // so the sentinel search is unambiguous even when revId contains hyphens.
        expect(extractLogicalRowId("turn-a1b2c3d4-e5f6-msg-00000000-dead-beef")).toBe(
            "msg-00000000-dead-beef",
        )
    })

    it("strips the turn-<entityId>- prefix from a legacy lt-<id> logical ID", () => {
        expect(extractLogicalRowId("turn-rev1-lt-old-id")).toBe("lt-old-id")
    })

    it("prefers msg- over lt- when both appear (current IDs take precedence)", () => {
        // Contrived but guards against a mis-ordered search.
        expect(extractLogicalRowId("turn-rev1-msg-foo-lt-bar")).toBe("msg-foo-lt-bar")
    })

    it("returns a non-turn rowId unchanged (no sentinel found)", () => {
        expect(extractLogicalRowId("step-abc")).toBe("step-abc")
        expect(extractLogicalRowId("")).toBe("")
    })
})

// ── resultsByKey entity extraction (Bug 3 fix) ──────────────────────────────
//
// `runStatusByRowEntityAtom` parses keys of the form "stepId:sess:entityId".
// The separator ":sess:" is 6 characters; the old code used `sepIdx + 5`,
// leaving a leading ":" on the entityId and producing a malformed map key.
// We test the parsing logic directly here as a pure string operation.

function parseResultKey(key: string): {stepId: string; entityId: string} | null {
    const sepIdx = key.indexOf(":sess:")
    if (sepIdx === -1) return null
    return {
        stepId: key.slice(0, sepIdx),
        // fixed: was sepIdx + 5 (off-by-one)
        entityId: key.slice(sepIdx + 6),
    }
}

describe("resultsByKey entity extraction (sepIdx + 6)", () => {
    it("extracts stepId and entityId from a well-formed result key", () => {
        expect(parseResultKey("msg-abc:sess:entity123")).toEqual({
            stepId: "msg-abc",
            entityId: "entity123",
        })
    })

    it("handles a UUID entityId with hyphens", () => {
        expect(parseResultKey("msg-abc:sess:a1b2-c3d4-e5f6")).toEqual({
            stepId: "msg-abc",
            entityId: "a1b2-c3d4-e5f6",
        })
    })

    it("returns null when the key has no :sess: segment", () => {
        expect(parseResultKey("msg-abc:entity123")).toBeNull()
    })

    it("produces a map key that matches the UI-side lookup", () => {
        const key = "msg-abc:sess:entity123"
        const parsed = parseResultKey(key)!
        const mapKey = `${parsed.stepId}:${parsed.entityId}`
        // The UI (TurnMessageAdapter) looks up by `"${rowId}:${entityId}"`.
        expect(mapKey).toBe("msg-abc:entity123")
    })
})

// ── logical rowId extraction in handleExecutionResultAtom (Bug 2 fix) ────────
//
// In comparison mode rowId = "turn-<entityUUID>-<logicalId>".  The old code
// only searched for "-lt-"; with current message IDs ("msg-<uuid>") the
// search always failed, leaving logicalRowId equal to the full compound string.
// flatById[compoundId] is always undefined, so the fallback fired and returned
// the LAST shared user message -- causing every turn to collide on that key.

function extractLogicalFromRowId(rowId: string): string {
    const msgIndex = rowId.indexOf("-msg-")
    const ltIndex = rowId.indexOf("-lt-")
    const sepIndex = msgIndex >= 0 ? msgIndex : ltIndex
    return sepIndex >= 0 ? rowId.slice(sepIndex + 1) : rowId
}

describe("handleExecutionResultAtom logical rowId extraction", () => {
    it("returns a plain msg-<uuid> rowId unchanged", () => {
        expect(extractLogicalFromRowId("msg-abc123")).toBe("msg-abc123")
    })

    it("extracts the msg-<uuid> logical ID from a comparison-mode compound rowId", () => {
        expect(extractLogicalFromRowId("turn-rev1-msg-abc123")).toBe("msg-abc123")
    })

    it("extracts the lt-<id> logical ID from a legacy comparison-mode compound rowId", () => {
        expect(extractLogicalFromRowId("turn-rev1-lt-old-id")).toBe("lt-old-id")
    })

    it("handles a UUID entity ID with hyphens", () => {
        expect(extractLogicalFromRowId("turn-a1b2-c3d4-msg-000-beef")).toBe("msg-000-beef")
    })

    it("returns the rowId unchanged when no sentinel is present", () => {
        expect(extractLogicalFromRowId("step-abc")).toBe("step-abc")
    })
})
