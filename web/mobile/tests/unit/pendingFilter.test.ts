import {describe, expect, it} from "vitest"

import {filterPendingRows} from "../../src/features/sessions/pendingFilter"

const row = (sessionId: string) => ({id: `row-${sessionId}`, session_id: sessionId})

describe("filterPendingRows", () => {
    it("keeps only the sessions with a pending gate", () => {
        const result = filterPendingRows([row("a"), row("b"), row("c")], new Map([["b", 1]]))
        expect(result.rows.map((r) => r.session_id)).toEqual(["b"])
        expect(result.unloaded).toBe(0)
    })

    it("counts waiting sessions the loaded pages do not contain", () => {
        // The interactions poll is project-wide; this one lives beyond the fetched pages.
        const result = filterPendingRows(
            [row("a")],
            new Map([
                ["a", 1],
                ["deep-in-page-4", 2],
            ]),
        )
        expect(result.rows.map((r) => r.session_id)).toEqual(["a"])
        expect(result.unloaded).toBe(1)
    })

    it("passes rows through untouched while the poll is unresolved", () => {
        const rows = [row("a"), row("b")]
        const result = filterPendingRows(rows, undefined)
        expect(result.rows).toBe(rows)
        expect(result.unloaded).toBe(0)
    })

    it("returns nothing when no session is waiting", () => {
        const result = filterPendingRows([row("a")], new Map())
        expect(result.rows).toEqual([])
        expect(result.unloaded).toBe(0)
    })

    it("ignores rows with no session id", () => {
        const result = filterPendingRows(
            [{id: "x", session_id: null}, row("a")],
            new Map([["a", 1]]),
        )
        expect(result.rows.map((r) => r.session_id)).toEqual(["a"])
    })

    // A search narrows `rows` but the interactions poll stays project-wide, so the waiting
    // sessions it knows about are mostly just non-matching. Counting them as "further down"
    // offers a Load more that can never surface them however many pages it fetches.
    it("reports no unloaded count while a search is narrowing the list", () => {
        const rows = [{session_id: "s1"}]
        const pending = new Map([
            ["s1", 1],
            ["s2", 1],
            ["s3", 2],
        ])

        expect(filterPendingRows(rows, pending, true)).toEqual({
            rows: [{session_id: "s1"}],
            unloaded: 0,
        })
    })

    it("still counts unloaded waiting sessions without a search", () => {
        const rows = [{session_id: "s1"}]
        const pending = new Map([
            ["s1", 1],
            ["s2", 1],
        ])

        expect(filterPendingRows(rows, pending, false)).toEqual({
            rows: [{session_id: "s1"}],
            unloaded: 1,
        })
    })
})
