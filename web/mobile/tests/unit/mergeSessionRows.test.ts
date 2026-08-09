import {describe, expect, it} from "vitest"

import {mergeSessionRows} from "../../src/features/sessions/mergeSessionRows"

const row = (sessionId: string, extra: Record<string, unknown> = {}) => ({
    id: `row-${sessionId}`,
    session_id: sessionId,
    ...extra,
})

describe("mergeSessionRows", () => {
    it("returns the paged rows unchanged when the head has nothing new", () => {
        const paged = [row("a"), row("b")]
        expect(mergeSessionRows([row("a"), row("b")], paged).map((r) => r.session_id)).toEqual([
            "a",
            "b",
        ])
    })

    it("surfaces a session the poll found but the pages predate", () => {
        expect(
            mergeSessionRows([row("new"), row("a")], [row("a"), row("b")]).map((r) => r.session_id),
        ).toEqual(["new", "a", "b"])
    })

    it("keeps a re-activated session once, at its new position", () => {
        // `b` was fetched deep in a page, then became the most recent — the head returns it at the
        // top. Without dedupe it renders twice: fresh above, stale below.
        const merged = mergeSessionRows([row("b")], [row("a"), row("b"), row("c")])
        expect(merged.map((r) => r.session_id)).toEqual(["b", "a", "c"])
    })

    it("prefers the head's copy of a row", () => {
        const merged = mergeSessionRows([row("a", {title: "fresh"})], [row("a", {title: "stale"})])
        expect(merged).toHaveLength(1)
        expect((merged[0] as {title?: string}).title).toBe("fresh")
    })

    it("drops archived rows from either side", () => {
        const merged = mergeSessionRows(
            [row("gone", {archived_at: "2026-08-03T00:00:00Z"})],
            [row("a"), row("also-gone", {archived_at: "2026-08-03T00:00:00Z"})],
        )
        expect(merged.map((r) => r.session_id)).toEqual(["a"])
    })

    it("drops rows with no identity rather than rendering an unlinkable row", () => {
        const merged = mergeSessionRows([], [{id: null, session_id: null}, row("a")])
        expect(merged.map((r) => r.session_id)).toEqual(["a"])
    })

    it("falls back to the row id when session_id is absent", () => {
        const merged = mergeSessionRows(
            [{id: "only-row-id", session_id: null}],
            [{id: "only-row-id", session_id: null}],
        )
        expect(merged).toHaveLength(1)
    })
})
